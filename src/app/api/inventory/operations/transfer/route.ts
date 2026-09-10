// ============================================================================
// LBMS Phase 8 API — Stock Transfer (warehouse-to-warehouse)
// ----------------------------------------------------------------------------
// POST /api/inventory/operations/transfer
//   Transfer stock from one warehouse to another. Atomic — creates a paired
//   TRANSFER_OUT + TRANSFER_IN movement sharing the same referenceId. If
//   either decrease or increase fails, the whole transaction rolls back.
//   Rejects if source has insufficient stock or if source==dest.
//   Requires `inventory:transfer`. Audit recorded.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, ok, badRequest, notFound, auditFromCtx, notDeleted } from "@/lib/api-helpers";
import {
  nextInventoryRefNumber,
  transferStock,
  validateQuantity,
  InsufficientStockError,
} from "@/lib/inventory-utils";
import { toMoney } from "@/lib/finance/money";

const decimalString = z.string().regex(/^\d+(\.\d{1,4})?$/, "Must be a positive decimal string");

const TransferSchema = z.object({
  inventoryItemId: z.string().min(1, "inventoryItemId is required"),
  fromWarehouseId: z.string().min(1, "fromWarehouseId is required"),
  toWarehouseId: z.string().min(1, "toWarehouseId is required"),
  quantity: decimalString,
  reason: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("inventory", "transfer");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = TransferSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  if (d.fromWarehouseId === d.toWarehouseId) {
    return badRequest("Source and destination warehouses must differ.");
  }

  let qtyStr: string;
  try { qtyStr = validateQuantity(d.quantity); } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Invalid quantity.");
  }
  const quantity = toMoney(qtyStr);

  // Validate item
  const item = await db.inventoryItem.findFirst({
    where: { id: d.inventoryItemId, ...notDeleted() },
    select: { id: true, itemCode: true, name: true, active: true },
  });
  if (!item) return notFound("Inventory item not found.");
  if (!item.active) return badRequest("Inventory item is inactive.");

  // Validate both warehouses
  const [fromWh, toWh] = await Promise.all([
    db.warehouse.findFirst({ where: { id: d.fromWarehouseId, ...notDeleted() }, select: { id: true, code: true, name: true, active: true } }),
    db.warehouse.findFirst({ where: { id: d.toWarehouseId, ...notDeleted() }, select: { id: true, code: true, name: true, active: true } }),
  ]);
  if (!fromWh) return notFound("Source warehouse not found.");
  if (!fromWh.active) return badRequest("Source warehouse is inactive.");
  if (!toWh) return notFound("Destination warehouse not found.");
  if (!toWh.active) return badRequest("Destination warehouse is inactive.");

  const year = new Date().getFullYear();

  try {
    const result = await db.$transaction(async (tx) => {
      const transferNumber = await nextInventoryRefNumber(tx, "TRF", year);
      const { outMovement, inMovement, sourceBalanceBefore, destBalanceBefore } = await transferStock(tx, {
        inventoryItemId: d.inventoryItemId,
        fromWarehouseId: d.fromWarehouseId,
        toWarehouseId: d.toWarehouseId,
        quantity,
        transferNumber,
        ctx: {
          performedById: auth.ctx.userId,
          reason: d.reason,
          notes: d.notes,
        },
      });
      return {
        outMovement, inMovement,
        sourceBalanceBefore: sourceBalanceBefore.toString(),
        sourceBalanceAfter: sourceBalanceBefore.minus(quantity).toString(),
        destBalanceBefore: destBalanceBefore.toString(),
        destBalanceAfter: destBalanceBefore.plus(quantity).toString(),
      };
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "inventory",
      recordId: result.outMovement.id,
      recordType: "StockMovement",
      description: `Transferred ${qtyStr} ${item.name} from ${fromWh.name} to ${toWh.name} (transfer ${result.outMovement.referenceId})`,
      newValue: {
        transferNumber: result.outMovement.referenceId,
        itemCode: item.itemCode,
        quantity: qtyStr,
        fromWarehouse: fromWh.code,
        toWarehouse: toWh.code,
        sourceBalanceBefore: result.sourceBalanceBefore,
        sourceBalanceAfter: result.sourceBalanceAfter,
        destBalanceBefore: result.destBalanceBefore,
        destBalanceAfter: result.destBalanceAfter,
      },
    });

    return ok(result, 201);
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return badRequest(err.message);
    }
    if (err instanceof Error && err.message.includes("Source and destination warehouses must differ")) {
      return badRequest(err.message);
    }
    throw err;
  }
}
