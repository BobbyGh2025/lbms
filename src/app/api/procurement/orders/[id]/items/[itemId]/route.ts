// ============================================================================
// LBMS Phase 7 API — Purchase Order Item single-record
// ----------------------------------------------------------------------------
// GET    /api/procurement/orders/[id]/items/[itemId]   fetch one item.
// PATCH  /api/procurement/orders/[id]/items/[itemId]   edit an item. Only
//   allowed before sending. Server recalculates item tax/total + PO totals.
//   Requires `procurement:edit`.
// DELETE /api/procurement/orders/[id]/items/[itemId]  delete an item. Only
//   allowed before sending AND only if the item has no receipts. Soft-cancel
//   is NOT used — the row is removed and PO totals recomputed. Requires
//   `procurement:edit`.
//
// Cross-PO item manipulation is prevented: the [itemId] must belong to the
// [id] PO, else 404.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import {
  computeItemTotals,
  recomputePurchaseOrderTotals,
  validateQuantity,
  validateUnitPrice,
  validateTaxRate,
  PO_ITEM_EDITABLE_STATUSES,
} from "@/lib/procurement-utils";

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, "Must be a positive decimal string");

const PatchItemSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  quantity: decimalString.optional(),
  unitPrice: decimalString.optional(),
  taxRate: decimalString.optional(),
});

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/** Load the item, ensuring it belongs to the path PO. */
async function loadOwnedItem(poId: string, itemId: string) {
  return db.purchaseOrderItem.findFirst({
    where: { id: itemId, purchaseOrderId: poId },
  });
}

// ---------------------------------------------------------------------------
// GET /api/procurement/orders/[id]/items/[itemId]
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorize("procurement", "view");
  if (!auth.ok) return auth.response;
  const { id, itemId } = await params;
  const item = await loadOwnedItem(id, itemId);
  if (!item) return notFound("Purchase order item not found.");
  return ok(item);
}

// ---------------------------------------------------------------------------
// PATCH /api/procurement/orders/[id]/items/[itemId]
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorize("procurement", "edit");
  if (!auth.ok) return auth.response;

  const { id, itemId } = await params;
  const po = await db.purchaseOrder.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, purchaseOrderNumber: true, status: true },
  });
  if (!po) return notFound("Purchase order not found.");

  if (!PO_ITEM_EDITABLE_STATUSES.has(po.status)) {
    return badRequest(
      `Cannot edit items of a ${po.status} purchase order.`,
    );
  }

  const existing = await loadOwnedItem(id, itemId);
  if (!existing) return notFound("Purchase order item not found.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }
  const parsed = PatchItemSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  const qtyStr = d.quantity ?? existing.quantity.toString();
  const priceStr = d.unitPrice ?? existing.unitPrice.toString();
  const taxRateStr = d.taxRate ?? existing.taxRate.toString();

  try {
    validateQuantity(qtyStr);
    validateUnitPrice(priceStr);
    validateTaxRate(taxRateStr);
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Invalid quantity/price/taxRate.");
  }

  const totals = computeItemTotals({
    quantity: qtyStr,
    unitPrice: priceStr,
    taxRate: taxRateStr,
  });

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.purchaseOrderItem.update({
      where: { id: itemId },
      data: {
        description: d.description !== undefined ? d.description.trim() : existing.description,
        quantity: qtyStr,
        unitPrice: priceStr,
        taxRate: taxRateStr,
        tax: totals.tax.toString(),
        total: totals.total.toString(),
      },
    });

    const poTotals = await recomputePurchaseOrderTotals(tx, id);
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        subtotal: poTotals.subtotal,
        tax: poTotals.tax,
        total: poTotals.total,
        updatedById: auth.ctx.userId,
      },
    });

    return { item: updated, poTotals };
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "procurement",
    recordId: itemId,
    recordType: "PurchaseOrderItem",
    description: `Updated item ${d.description ?? existing.description} on PO ${po.purchaseOrderNumber}`,
    previousValue: existing,
    newValue: result.item,
  });

  return ok(result);
}

// ---------------------------------------------------------------------------
// DELETE /api/procurement/orders/[id]/items/[itemId]
// ---------------------------------------------------------------------------
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorize("procurement", "edit");
  if (!auth.ok) return auth.response;

  const { id, itemId } = await params;
  const po = await db.purchaseOrder.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, purchaseOrderNumber: true, status: true },
  });
  if (!po) return notFound("Purchase order not found.");

  if (!PO_ITEM_EDITABLE_STATUSES.has(po.status)) {
    return badRequest(
      `Cannot delete items from a ${po.status} purchase order.`,
    );
  }

  const existing = await loadOwnedItem(id, itemId);
  if (!existing) return notFound("Purchase order item not found.");

  // Block deletion if item has been received.
  const receiptCount = await db.goodsReceiptItem.count({
    where: { purchaseOrderItemId: itemId },
  });
  if (receiptCount > 0) {
    return badRequest(
      "Cannot delete an item that has already been received. Cancel the PO instead.",
    );
  }

  const result = await db.$transaction(async (tx) => {
    await tx.purchaseOrderItem.delete({ where: { id: itemId } });
    const poTotals = await recomputePurchaseOrderTotals(tx, id);
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        subtotal: poTotals.subtotal,
        tax: poTotals.tax,
        total: poTotals.total,
        updatedById: auth.ctx.userId,
      },
    });
    return poTotals;
  });

  await auditFromCtx(auth.ctx, {
    action: "delete",
    module: "procurement",
    recordId: itemId,
    recordType: "PurchaseOrderItem",
    description: `Deleted item "${existing.description}" from PO ${po.purchaseOrderNumber}`,
    previousValue: existing,
    newValue: { poTotals: result },
  });

  return ok({ deleted: true, poTotals: result });
}
