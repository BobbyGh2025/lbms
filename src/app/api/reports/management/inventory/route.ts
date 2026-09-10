// ============================================================================
// LBMS Phase 9 API — Inventory Analytics
// GET /api/reports/management/inventory?preset=month
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, ok } from "@/lib/api-helpers";
import { parseDateRange } from "@/lib/report-utils";
import { serializeMoney, toMoney } from "@/lib/finance/money";

export async function GET(req: NextRequest) {
  const auth = await authorize("reports", "view");
  if (!auth.ok) return auth.response;
  const range = parseDateRange(req.nextUrl.searchParams);

  const [totalItems, activeWarehouses, movementTypeCounts, movementsByWarehouse, lowStockBalances, topMovedItems] = await Promise.all([
    db.inventoryItem.count({ where: { deletedAt: null } }),
    db.warehouse.count({ where: { deletedAt: null, active: true } }),
    db.stockMovement.groupBy({
      by: ["movementType"],
      where: { createdAt: { gte: range.from, lte: range.to } },
      _count: true,
      _sum: { quantity: true },
    }),
    db.stockMovement.groupBy({
      by: ["warehouseId"],
      where: { createdAt: { gte: range.from, lte: range.to } },
      _count: true,
    }),
    // Low-stock items
    db.stockBalance.findMany({
      where: { inventoryItem: { active: true, deletedAt: null } },
      select: { id: true, quantity: true, inventoryItemId: true, warehouseId: true,
        inventoryItem: { select: { id: true, itemCode: true, name: true, unitOfMeasure: true, reorderLevel: true } },
        warehouse: { select: { id: true, code: true, name: true } },
      },
    }),
    db.stockMovement.groupBy({
      by: ["inventoryItemId"],
      where: { createdAt: { gte: range.from, lte: range.to } },
      _count: true,
      orderBy: { inventoryItemId: "asc" },
      take: 100,
    }),
  ]);

  const whIds = movementsByWarehouse.map(r => r.warehouseId);
  const warehouses = await db.warehouse.findMany({ where: { id: { in: whIds } }, select: { id: true, code: true, name: true } });
  const whMap = new Map(warehouses.map(w => [w.id, w]));
  const activityByWarehouse = movementsByWarehouse.map(r => {
    const w = whMap.get(r.warehouseId);
    return { warehouseId: r.warehouseId, code: w?.code ?? null, name: w?.name ?? "Unknown", movementCount: r._count };
  });

  const lowStockItems = lowStockBalances
    .filter(b => Number(b.quantity) <= Number(b.inventoryItem.reorderLevel))
    .map(b => ({
      itemId: b.inventoryItemId,
      itemCode: b.inventoryItem.itemCode,
      name: b.inventoryItem.name,
      warehouseCode: b.warehouse.code,
      warehouseName: b.warehouse.name,
      quantity: serializeMoney(toMoney(b.quantity)),
      reorderLevel: serializeMoney(toMoney(b.inventoryItem.reorderLevel)),
      unitOfMeasure: b.inventoryItem.unitOfMeasure,
    }));

  const topItemIds = topMovedItems.map(r => r.inventoryItemId);
  const topItems = await db.inventoryItem.findMany({ where: { id: { in: topItemIds } }, select: { id: true, itemCode: true, name: true, unitOfMeasure: true } });
  const topItemMap = new Map(topItems.map(i => [i.id, i]));
  const mostActiveItems = topMovedItems
    .map(r => {
      const i = topItemMap.get(r.inventoryItemId);
      return { itemId: r.inventoryItemId, itemCode: i?.itemCode ?? null, name: i?.name ?? "Unknown", movementCount: r._count };
    })
    .sort((a, b) => b.movementCount - a.movementCount)
    .slice(0, 10);

  return ok({
    period: { from: range.from.toISOString(), to: range.to.toISOString(), preset: range.preset, label: range.label },
    totals: {
      totalItems,
      activeWarehouses,
      movementsInPeriod: movementTypeCounts.reduce((s, r) => s + r._count, 0),
      lowStockCount: lowStockItems.length,
    },
    movementByType: movementTypeCounts.map(r => ({ movementType: r.movementType, count: r._count, totalQuantity: serializeMoney(toMoney(r._sum.quantity ?? 0)) })),
    activityByWarehouse,
    lowStockItems,
    mostActiveItems,
  });
}
