// ============================================================================
// LBMS Phase 8 API — Stock balances + movements query
// ----------------------------------------------------------------------------
// GET /api/inventory/stock          list all stock balances (with item +
//   warehouse info). Filters: warehouseId, inventoryItemId, lowStock. Requires
//   `inventory:view`.
// GET /api/inventory/stock/movements paginated movement history. Filters:
//   inventoryItemId, warehouseId, movementType. Requires `inventory:view`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, ok } from "@/lib/api-helpers";
import { toMoney } from "@/lib/finance/money";

// GET /api/inventory/stock
export async function GET(req: NextRequest) {
  const auth = await authorize("inventory", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const warehouseId = sp.get("warehouseId")?.trim() || undefined;
  const inventoryItemId = sp.get("inventoryItemId")?.trim() || undefined;
  const lowStockOnly = sp.get("lowStock") === "true";

  const where: Record<string, unknown> = {};
  if (warehouseId) where.warehouseId = warehouseId;
  if (inventoryItemId) where.inventoryItemId = inventoryItemId;

  const balances = await db.stockBalance.findMany({
    where,
    include: {
      inventoryItem: {
        select: { id: true, itemCode: true, name: true, unitOfMeasure: true, reorderLevel: true, active: true, deletedAt: true },
      },
      warehouse: { select: { id: true, code: true, name: true, active: true } },
    },
    orderBy: [{ warehouseId: "asc" }, { inventoryItem: { itemCode: "asc" } }],
  });

  // Filter low-stock items (quantity <= reorderLevel) if requested
  let result = balances;
  if (lowStockOnly) {
    result = balances.filter((b) => {
      const qty = toMoney(b.quantity);
      const reorder = toMoney(b.inventoryItem.reorderLevel);
      return qty.lte(reorder) && b.inventoryItem.active && !b.inventoryItem.deletedAt;
    });
  }

  return ok({ items: result });
}
