// ============================================================================
// LBMS Phase 8 API — Stock Adjustment
// ----------------------------------------------------------------------------
// POST /api/inventory/operations/adjust
//   Adjust stock at a warehouse (positive or negative delta). Creates an
//   ADJUSTMENT_IN or ADJUSTMENT_OUT movement depending on the direction.
//   The caller passes the DELTA (not the new balance). Negative adjustments
//   that would make stock negative are rejected. Requires `inventory:adjust`.
//   Audit recorded.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, ok, badRequest, notFound, auditFromCtx, notDeleted } from "@/lib/api-helpers";
import {
  nextInventoryRefNumber,
  adjustStock,
  InsufficientStockError,
} from "@/lib/inventory-utils";
import { toMoney } from "@/lib/finance/money";

const decimalString = z.string().regex(/^-?\d+(\.\d{1,4})?$/, "Must be a decimal string (negative allowed for adjustments)");

const AdjustSchema = z.object({
  inventoryItemId: z.string().min(1, "inventoryItemId is required"),
  warehouseId: z.string().min(1, "warehouseId is required"),
  delta: decimalString, // positive = increase, negative = decrease
  reason: z.string().min(1, "A reason is required for adjustments").max(500),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("inventory", "adjust");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = AdjustSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Validate delta is non-zero
  const delta = toMoney(d.delta);
  if (delta.isZero()) {
    return badRequest("Adjustment delta must be non-zero.");
  }
  if (delta.abs().gt(1_000_000_000)) {
    return badRequest("Adjustment delta exceeds maximum allowed value of 1,000,000,000.");
  }

  // Validate item
  const item = await db.inventoryItem.findFirst({
    where: { id: d.inventoryItemId, ...notDeleted() },
    select: { id: true, itemCode: true, name: true, active: true },
  });
  if (!item) return notFound("Inventory item not found.");
  if (!item.active) return badRequest("Inventory item is inactive.");

  // Validate warehouse
  const wh = await db.warehouse.findFirst({
    where: { id: d.warehouseId, ...notDeleted() },
    select: { id: true, code: true, name: true, active: true },
  });
  if (!wh) return notFound("Warehouse not found.");
  if (!wh.active) return badRequest("Warehouse is inactive.");

  const year = new Date().getFullYear();

  try {
    const result = await db.$transaction(async (tx) => {
      const adjustmentNumber = await nextInventoryRefNumber(tx, "ADJ", year);
      const { movement, balanceBefore, balanceAfter } = await adjustStock(tx, {
        inventoryItemId: d.inventoryItemId,
        warehouseId: d.warehouseId,
        delta,
        adjustmentNumber,
        ctx: {
          performedById: auth.ctx.userId,
          reason: d.reason,
          notes: d.notes,
        },
      });
      return { movement, balanceBefore: balanceBefore.toString(), balanceAfter: balanceAfter.toString() };
    });

    const direction = delta.gt(0) ? "increase" : "decrease";
    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "inventory",
      recordId: result.movement.id,
      recordType: "StockMovement",
      description: `Adjusted ${item.name} at ${wh.name} by ${delta.toString()} (${direction}) — movement ${result.movement.movementNumber}`,
      newValue: {
        movementNumber: result.movement.movementNumber,
        movementType: result.movement.movementType,
        itemCode: item.itemCode,
        warehouseCode: wh.code,
        delta: delta.toString(),
        reason: d.reason,
        balanceBefore: result.balanceBefore,
        balanceAfter: result.balanceAfter,
      },
    });

    return ok(result, 201);
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return badRequest(err.message);
    }
    throw err;
  }
}
