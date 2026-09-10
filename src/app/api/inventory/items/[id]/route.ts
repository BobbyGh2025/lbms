// ============================================================================
// LBMS Phase 8 API — Inventory Item single-record
// ----------------------------------------------------------------------------
// GET    /api/inventory/items/[id]   fetch one item with stock balances + recent
//   movements. Requires `inventory:view`.
// PATCH  /api/inventory/items/[id]   edit an item. itemCode immutable. Requires
//   `inventory:edit`. Audit with prev+new.
// DELETE /api/inventory/items/[id]   soft-delete (deactivate) an item. Hard
//   delete blocked if the item has stock movements (historical integrity).
//   Requires `inventory:edit`. Audit.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { validateReorderLevel } from "@/lib/inventory-utils";

const decimalString = z.string().regex(/^\d+(\.\d{1,4})?$/, "Must be a positive decimal string");

const PatchItemSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  categoryId: z.string().nullable().optional(),
  unitOfMeasure: z.string().min(1).max(50).optional(),
  reorderLevel: decimalString.optional(),
  reorderQuantity: decimalString.optional(),
  active: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorize("inventory", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const item = await db.inventoryItem.findFirst({
    where: { id, ...notDeleted() },
    include: {
      category: { select: { id: true, name: true, description: true } },
      createdBy: { select: { id: true, username: true } },
      stockBalances: {
        include: { warehouse: { select: { id: true, code: true, name: true } } },
      },
      movements: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          performedBy: { select: { id: true, username: true } },
        },
      },
      _count: { select: { movements: true } },
    },
  });
  if (!item) return notFound("Inventory item not found.");

  return ok(item);
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorize("inventory", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.inventoryItem.findFirst({ where: { id, ...notDeleted() } });
  if (!existing) return notFound("Inventory item not found.");

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }

  const parsed = PatchItemSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Validate category if changing
  if (d.categoryId !== undefined && d.categoryId) {
    const cat = await db.inventoryCategory.findFirst({ where: { id: d.categoryId } });
    if (!cat) return badRequest("Selected category does not exist.");
  }

  // Validate reorder fields
  let reorderLevel: string | undefined;
  let reorderQuantity: string | undefined;
  try {
    if (d.reorderLevel !== undefined) reorderLevel = validateReorderLevel(d.reorderLevel);
    if (d.reorderQuantity !== undefined) reorderQuantity = validateReorderLevel(d.reorderQuantity);
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Invalid reorder values.");
  }

  const data: Record<string, unknown> = { updatedById: auth.ctx.userId };
  if (d.name !== undefined) data.name = d.name.trim();
  if (d.description !== undefined) data.description = d.description?.trim() || null;
  if (d.categoryId !== undefined) data.categoryId = d.categoryId || null;
  if (d.unitOfMeasure !== undefined) data.unitOfMeasure = d.unitOfMeasure.trim();
  if (reorderLevel !== undefined) data.reorderLevel = reorderLevel;
  if (reorderQuantity !== undefined) data.reorderQuantity = reorderQuantity;
  if (d.active !== undefined) data.active = d.active;

  const updated = await db.inventoryItem.update({
    where: { id },
    data,
    include: { category: { select: { id: true, name: true } } },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "inventory",
    recordId: updated.id,
    recordType: "InventoryItem",
    description: `Updated inventory item ${updated.itemCode} (${updated.name})`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}

// ---------------------------------------------------------------------------
// DELETE (soft-delete / deactivate)
// ---------------------------------------------------------------------------
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorize("inventory", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.inventoryItem.findFirst({
    where: { id, ...notDeleted() },
    include: { _count: { select: { movements: true } } },
  });
  if (!existing) return notFound("Inventory item not found.");

  // Block hard-delete if the item has historical movements
  if (existing._count.movements > 0) {
    // Soft-deactivate instead
    const updated = await db.inventoryItem.update({
      where: { id },
      data: { active: false, deletedAt: new Date(), updatedById: auth.ctx.userId },
    });
    await auditFromCtx(auth.ctx, {
      action: "update",
      module: "inventory",
      recordId: updated.id,
      recordType: "InventoryItem",
      description: `Deactivated inventory item ${updated.itemCode} (has ${existing._count.movements} historical movements — soft-deleted, not hard-deleted)`,
      previousValue: { active: existing.active, deletedAt: null },
      newValue: { active: false, deletedAt: updated.deletedAt },
    });
    return ok({ deactivated: true, hardDeleted: false, movementCount: existing._count.movements });
  }

  // No movements — safe to hard delete
  await db.inventoryItem.delete({ where: { id } });
  await auditFromCtx(auth.ctx, {
    action: "delete",
    module: "inventory",
    recordId: existing.id,
    recordType: "InventoryItem",
    description: `Deleted inventory item ${existing.itemCode} (no historical movements)`,
    previousValue: existing,
  });
  return ok({ deactivated: false, hardDeleted: true });
}
