// ============================================================================
// LBMS Phase 11 API — Supplier Bill Items collection
// ----------------------------------------------------------------------------
// POST /api/payables/bills/[id]/items   add a line item to a bill. Only
//   allowed while the bill is in DRAFT. Validates quantity > 0, unitPrice >= 0.
//   Server-calculates per-line total + recomputes bill subtotal/tax/total +
//   balanceDue. Optional inventoryItemId + ledgerAccountCode for expense
//   classification (defaults to "EXP-OTHER" at posting time).
//   Requires `payables:edit`.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import {
  recomputeBillTotals,
  recomputeBillBalance,
  validateQuantity,
  validateUnitPrice,
} from "@/lib/ap-utils";
import { roundMoney, toMoney, serializeMoney } from "@/lib/finance/money";

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, "Must be a positive decimal string");

const CreateBillItemSchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  inventoryItemId: z.string().optional(),
  quantity: decimalString,
  unitPrice: decimalString,
  ledgerAccountCode: z.string().max(50).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("payables", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const bill = await db.supplierBill.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, billNumber: true, status: true },
  });
  if (!bill) return notFound("Supplier bill not found.");

  if (bill.status !== "draft") {
    return badRequest(
      `Cannot add items to a ${bill.status} bill. Only draft bills accept new line items.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateBillItemSchema.safeParse(body);
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

  let qtyStr: string, priceStr: string;
  try {
    qtyStr = validateQuantity(d.quantity);
    priceStr = validateUnitPrice(d.unitPrice);
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Invalid quantity/price.");
  }

  const lineTotal = roundMoney(toMoney(qtyStr).times(toMoney(priceStr)));
  const totalStr = serializeMoney(lineTotal);

  try {
    const result = await db.$transaction(async (tx) => {
      const item = await tx.supplierBillItem.create({
        data: {
          supplierBillId: id,
          inventoryItemId: d.inventoryItemId || null,
          description: d.description.trim(),
          quantity: qtyStr,
          unitPrice: priceStr,
          total: totalStr,
          ledgerAccountCode: d.ledgerAccountCode?.trim() || null,
        },
      });

      const billTotals = await recomputeBillTotals(tx, id);
      // Update bill totals FIRST so recomputeBillBalance sees the new total
      const updatedBill = await tx.supplierBill.update({
        where: { id },
        data: {
          subtotal: billTotals.subtotal,
          tax: billTotals.tax,
          total: billTotals.total,
          updatedById: auth.ctx.userId,
        },
      });
      // Now recompute the balance with the updated total
      const bal = await recomputeBillBalance(tx, id);
      await tx.supplierBill.update({
        where: { id },
        data: {
          amountPaid: bal?.amountPaid ?? "0",
          balanceDue: bal?.balanceDue ?? billTotals.total,
        },
      });

      return { item, billTotals, balance: bal, updatedBill };
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "payables",
      recordId: result.item.id,
      recordType: "SupplierBillItem",
      description: `Added item to bill ${bill.billNumber}: ${d.description} (qty ${qtyStr} × ${priceStr})`,
      newValue: { item: result.item, billTotals: result.billTotals },
    });

    return ok(result, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A constraint error occurred. Please retry.");
    }
    throw err;
  }
}
