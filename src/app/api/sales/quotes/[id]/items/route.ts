// ============================================================================
// LBMS Phase 10 API — Quote Items collection
// ----------------------------------------------------------------------------
// POST /api/sales/quotes/[id]/items   add a line item to a quote. Only allowed
//   while the quote is in DRAFT. Validates quantity > 0, unitPrice >= 0,
//   taxRate 0–100, discount >= 0. Server-calculates subtotal/tax/total per
//   line + recompute quote totals. Requires `sales:edit`.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import {
  computeItemLineTotal,
  recomputeQuoteTotals,
  validateQuantity,
  validateUnitPrice,
  validateTaxRate,
  validateDiscount,
} from "@/lib/sales-utils";

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, "Must be a positive decimal string");

const CreateQuoteItemSchema = z.object({
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
  const quote = await db.quote.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, quoteNumber: true, status: true },
  });
  if (!quote) return notFound("Quote not found.");

  if (quote.status !== "draft") {
    return badRequest(
      `Cannot add items to a ${quote.status} quote. Only draft quotes accept new line items.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateQuoteItemSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Validate optional inventoryItemId
  if (d.inventoryItemId) {
    const item = await db.inventoryItem.findFirst({
      where: { id: d.inventoryItemId, ...notDeleted() },
      select: { id: true, itemCode: true, name: true },
    });
    if (!item) return badRequest("Selected inventory item does not exist or is inactive.");
  }

  // Validate numeric fields (server-side, never trusts client).
  let qtyStr: string, priceStr: string, taxRateStr: string, discountStr: string;
  try {
    qtyStr = validateQuantity(d.quantity);
    priceStr = validateUnitPrice(d.unitPrice);
    taxRateStr = validateTaxRate(d.taxRate ?? "0");
    discountStr = validateDiscount(d.discount ?? "0");
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Invalid quantity/price/tax/discount.");
  }

  // Server-side line totals.
  const totals = computeItemLineTotal({
    quantity: qtyStr,
    unitPrice: priceStr,
    discount: discountStr,
    taxRate: taxRateStr,
  });

  // Discount cannot exceed gross (qty × price).
  const gross = totals.subtotal.minus(totals.discount);
  if (gross.lt(0)) {
    return badRequest("Line discount cannot exceed gross (quantity × unit price).");
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const item = await tx.quoteItem.create({
        data: {
          quoteId: id,
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

      const quoteTotals = await recomputeQuoteTotals(tx, id);
      const updatedQuote = await tx.quote.update({
        where: { id },
        data: {
          subtotal: quoteTotals.subtotal,
          tax: quoteTotals.tax,
          total: quoteTotals.total,
          updatedById: auth.ctx.userId,
        },
      });

      return { item, quoteTotals, updatedQuote };
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "sales",
      recordId: result.item.id,
      recordType: "QuoteItem",
      description: `Added item to quote ${quote.quoteNumber}: ${d.description} (qty ${qtyStr} × ${priceStr})`,
      newValue: { item: result.item, quoteTotals: result.quoteTotals },
    });

    return ok(result, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A constraint error occurred. Please retry.");
    }
    throw err;
  }
}
