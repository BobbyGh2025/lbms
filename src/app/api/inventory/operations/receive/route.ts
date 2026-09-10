// ============================================================================
// LBMS Phase 8 API — Stock Receipt (from Goods Receipt)
// ----------------------------------------------------------------------------
// POST /api/inventory/operations/receive
//   Receive goods from a procurement GoodsReceiptItem into a warehouse. Creates
//   a RECEIPT movement + increases the StockBalance.
//
//   DOUBLE-POSTING PREVENTION (critical):
//     - The GoodsReceiptItem.inventoryPostedAt marker is checked BEFORE posting.
//     - The StockMovement @@unique([referenceType, referenceId]) constraint
//       (referenceType="goods_receipt_item", referenceId=GoodsReceiptItem.id)
//       enforces uniqueness at the DB level — a concurrent second posting is
//       rejected by the constraint even if the marker check is raced.
//     - The marker is set INSIDE the transaction after the movement is created.
//
//   The quantity posted is bounded by the GoodsReceiptItem.receivedQuantity —
//   inventory cannot receive more than procurement recorded as received.
//
//   Requires `inventory:receive`. Audit recorded.
//
// FINANCE BOUNDARY: This endpoint does NOT create any Journal entries. Stock
// quantities are operational, not accounting entries.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, ok, badRequest, notFound, auditFromCtx, notDeleted } from "@/lib/api-helpers";
import {
  nextInventoryRefNumber,
  receiveStockFromGoodsReceipt,
  validateQuantity,
} from "@/lib/inventory-utils";
import { toMoney } from "@/lib/finance/money";

const decimalString = z.string().regex(/^\d+(\.\d{1,4})?$/, "Must be a positive decimal string");

const ReceiveSchema = z.object({
  goodsReceiptItemId: z.string().min(1, "goodsReceiptItemId is required"),
  inventoryItemId: z.string().min(1, "inventoryItemId is required"),
  warehouseId: z.string().min(1, "warehouseId is required"),
  quantity: decimalString,
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("inventory", "receive");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = ReceiveSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Validate quantity
  let qtyStr: string;
  try { qtyStr = validateQuantity(d.quantity); } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Invalid quantity.");
  }
  const quantity = toMoney(qtyStr);

  // Validate inventory item exists + active + not deleted
  const item = await db.inventoryItem.findFirst({
    where: { id: d.inventoryItemId, ...notDeleted() },
    select: { id: true, itemCode: true, name: true, active: true },
  });
  if (!item) return notFound("Inventory item not found.");
  if (!item.active) return badRequest("Inventory item is inactive.");

  // Validate warehouse exists + active + not deleted
  const wh = await db.warehouse.findFirst({
    where: { id: d.warehouseId, ...notDeleted() },
    select: { id: true, code: true, name: true, active: true },
  });
  if (!wh) return notFound("Warehouse not found.");
  if (!wh.active) return badRequest("Warehouse is inactive.");

  // Validate the GoodsReceiptItem exists + is part of a completed receipt +
  // has not already been posted to inventory (marker check).
  const grItem = await db.goodsReceiptItem.findUnique({
    where: { id: d.goodsReceiptItemId },
    include: {
      goodsReceipt: {
        select: { id: true, receiptNumber: true, status: true, supplierId: true, purchaseOrderId: true,
          purchaseOrder: { select: { projectId: true } } },
      },
    },
  });
  if (!grItem) return notFound("Goods receipt item not found.");

  if (grItem.goodsReceipt.status !== "completed") {
    return badRequest(`Cannot post a ${grItem.goodsReceipt.status} goods receipt to inventory.`);
  }

  // Double-posting prevention: marker check
  if (grItem.inventoryPostedAt) {
    return badRequest(
      `Goods receipt item already posted to inventory at ${grItem.inventoryPostedAt.toISOString()}. Double-posting is not permitted.`,
    );
  }

  // Quantity bound: cannot post more than the goods receipt item's receivedQuantity
  const grReceivedQty = toMoney(grItem.receivedQuantity);
  if (quantity.gt(grReceivedQty)) {
    return badRequest(
      `Cannot post ${qtyStr} to inventory: goods receipt item only received ${grReceivedQty.toString()}.`,
    );
  }

  const year = new Date().getFullYear();

  try {
    const result = await db.$transaction(async (tx) => {
      const movementNumber = await nextInventoryRefNumber(tx, "SRI", year);

      const { movement, balanceBefore, balanceAfter } = await receiveStockFromGoodsReceipt(tx, {
        goodsReceiptItemId: d.goodsReceiptItemId,
        inventoryItemId: d.inventoryItemId,
        warehouseId: d.warehouseId,
        quantity,
        movementNumber,
        notes: d.notes,
        ctx: {
          performedById: auth.ctx.userId,
          supplierId: grItem.goodsReceipt.supplierId,
          projectId: grItem.goodsReceipt.purchaseOrder.projectId ?? undefined,
        },
      });

      // Set the inventory-posted marker on the goods receipt item
      await tx.goodsReceiptItem.update({
        where: { id: d.goodsReceiptItemId },
        data: { inventoryPostedAt: new Date() },
      });

      return { movement, balanceBefore: balanceBefore.toString(), balanceAfter: balanceAfter.toString() };
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "inventory",
      recordId: result.movement.id,
      recordType: "StockMovement",
      description: `Received ${qtyStr} ${item.name} into ${wh.name} from GR ${grItem.goodsReceipt.receiptNumber} (movement ${result.movement.movementNumber})`,
      newValue: {
        movementNumber: result.movement.movementNumber,
        movementType: "RECEIPT",
        itemCode: item.itemCode,
        warehouseCode: wh.code,
        quantity: qtyStr,
        balanceBefore: result.balanceBefore,
        balanceAfter: result.balanceAfter,
        goodsReceiptItem: d.goodsReceiptItemId,
      },
    });

    return ok(result, 201);
  } catch (err) {
    // Unique constraint violation = double-posting attempt (concurrent)
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("This goods receipt item has already been posted to inventory (concurrent attempt rejected).");
    }
    throw err;
  }
}
