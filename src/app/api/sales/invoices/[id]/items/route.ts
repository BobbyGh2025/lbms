// ============================================================================
// LBMS Phase 10 API — Invoice Items collection
// ----------------------------------------------------------------------------
// POST /api/sales/invoices/[id]/items   add a line item to an invoice. Only
//   allowed while the invoice is in DRAFT. Validates quantity > 0, unitPrice >= 0,
//   taxRate 0–100, discount >= 0. Server-calculates per-line totals + recomputes
//   invoice subtotal/tax/total + balanceDue. Requires `sales:edit`.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import {
  computeItemLineTotal,
  recomputeInvoiceTotals,
  recomputeInvoiceBalance,
  validateQuantity,
  validateUnitPrice,
  validateTaxRate,
  validateDiscount,
} from "@/lib/sales-utils";

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, "Must be a positive decimal string");

const CreateInvoiceItemSchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  inventoryItemId: z.string().optional(),
  quantity: decimalString,
  unitPrice: decimalString,
  discount: decimalString.optional(),
  taxRate: decimalString.optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const invoice = await db.invoice.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, invoiceNumber: true, status: true },
  });
  if (!invoice) return notFound("Invoice not found.");

  if (invoice.status !== "draft") {
    return badRequest(
      `Cannot add items to a ${invoice.status} invoice. Only draft invoices accept new line items.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateInvoiceItemSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  if (d.inventoryItemId) {
    const item = await db.inventoryItem.findFirst({
      where: { id: d.inventoryItemId, ...notDeleted() },
      select: { id: true, itemCode: true, name: true },
    });
    if (!item) return badRequest("Selected inventory item does not exist or is inactive.");
  }

  let qtyStr: string, priceStr: string, taxRateStr: string, discountStr: string;
  try {
    qtyStr = validateQuantity(d.quantity);
    priceStr = validateUnitPrice(d.unitPrice);
    taxRateStr = validateTaxRate(d.taxRate ?? "0");
    discountStr = validateDiscount(d.discount ?? "0");
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Invalid quantity/price/tax/discount.");
  }

  const totals = computeItemLineTotal({
    quantity: qtyStr,
    unitPrice: priceStr,
    discount: discountStr,
    taxRate: taxRateStr,
  });

  const gross = totals.subtotal.minus(totals.discount);
  if (gross.lt(0)) {
    return badRequest("Line discount cannot exceed gross (quantity × unit price).");
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const item = await tx.invoiceItem.create({
        data: {
          invoiceId: id,
          inventoryItemId: d.inventoryItemId || null,
          description: d.description.trim(),
          quantity: qtyStr,
          unitPrice: priceStr,
          discount: discountStr,
          taxRate: taxRateStr,
          tax: totals.tax.toString(),
          total: totals.total.toString(),
        },
      });

      const invTotals = await recomputeInvoiceTotals(tx, id);
      // Update the invoice totals FIRST so recomputeInvoiceBalance sees the new total
      const updatedInv = await tx.invoice.update({
        where: { id },
        data: {
          subtotal: invTotals.subtotal,
          tax: invTotals.tax,
          total: invTotals.total,
          updatedById: auth.ctx.userId,
        },
      });
      // Now recompute the balance with the updated total
      const bal = await recomputeInvoiceBalance(tx, id);
      await tx.invoice.update({
        where: { id },
        data: {
          amountPaid: bal?.amountPaid ?? "0",
          balanceDue: bal?.balanceDue ?? invTotals.total,
        },
      });

      return { item, invTotals, balance: bal, updatedInv };
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "sales",
      recordId: result.item.id,
      recordType: "InvoiceItem",
      description: `Added item to invoice ${invoice.invoiceNumber}: ${d.description} (qty ${qtyStr} × ${priceStr})`,
      newValue: { item: result.item, invTotals: result.invTotals },
    });

    return ok(result, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A constraint error occurred. Please retry.");
    }
    throw err;
  }
}
