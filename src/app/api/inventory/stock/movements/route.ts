// ============================================================================
// LBMS Phase 8 API — Stock movement history (paginated)
// GET /api/inventory/stock/movements
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, ok } from "@/lib/api-helpers";
import { MOVEMENT_TYPES } from "@/lib/inventory-utils";

export async function GET(req: NextRequest) {
  const auth = await authorize("inventory", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const inventoryItemId = sp.get("inventoryItemId")?.trim() || undefined;
  const warehouseId = sp.get("warehouseId")?.trim() || undefined;
  const movementType = sp.get("movementType")?.trim() || undefined;

  const where: Record<string, unknown> = {};
  if (inventoryItemId) where.inventoryItemId = inventoryItemId;
  if (warehouseId) where.warehouseId = warehouseId;
  if (movementType && (MOVEMENT_TYPES as readonly string[]).includes(movementType)) where.movementType = movementType;
  if (search) where.movementNumber = { contains: search };

  const [total, items] = await Promise.all([
    db.stockMovement.count({ where }),
    db.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        inventoryItem: { select: { id: true, itemCode: true, name: true, unitOfMeasure: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        counterpartWarehouse: { select: { id: true, code: true, name: true } },
        performedBy: { select: { id: true, username: true } },
        project: { select: { id: true, projectNumber: true, name: true } },
        task: { select: { id: true, taskNumber: true, title: true } },
      },
    }),
  ]);

  return ok({
    items,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}
