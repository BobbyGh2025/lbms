// ============================================================================
// LBMS Phase 8 API — Inventory Items collection
// ----------------------------------------------------------------------------
// GET  /api/inventory/items   paginated, searchable, filterable list.
//   Search matches itemCode + name. Filters: categoryId, active. Requires
//   `inventory:view`.
// POST /api/inventory/items   create a new inventory item. itemCode must be
//   unique. Requires `inventory:create`. Audit recorded.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { validateReorderLevel } from "@/lib/inventory-utils";

const decimalString = z.string().regex(/^\d+(\.\d{1,4})?$/, "Must be a positive decimal string");

// ---------------------------------------------------------------------------
// GET /api/inventory/items
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("inventory", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const categoryId = sp.get("categoryId")?.trim() || undefined;
  const active = sp.get("active")?.trim();
  const lowStockOnly = sp.get("lowStock") === "true";

  const where: Record<string, unknown> = {
    ...notDeleted(),
    ...(search ? { OR: [{ itemCode: { contains: search } }, { name: { contains: search } }] } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(active === "true" ? { active: true } : active === "false" ? { active: false } : {}),
  };

  const [total, items] = await Promise.all([
    db.inventoryItem.count({ where }),
    db.inventoryItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        category: { select: { id: true, name: true } },
        _count: { select: { stockBalances: true, movements: true } },
      },
    }),
  ]);

  return ok({
    items,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

// ---------------------------------------------------------------------------
// POST /api/inventory/items
// ---------------------------------------------------------------------------
const CreateItemSchema = z.object({
  itemCode: z.string().min(1, "Item code is required").max(50),
  name: z.string().min(1, "Name is required").max(300),
  description: z.string().max(5000).optional(),
  categoryId: z.string().optional(),
  unitOfMeasure: z.string().min(1).max(50).optional(),
  reorderLevel: decimalString.optional(),
  reorderQuantity: decimalString.optional(),
  active: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("inventory", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }

  const parsed = CreateItemSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Validate itemCode uniqueness
  const existing = await db.inventoryItem.findUnique({ where: { itemCode: d.itemCode } });
  if (existing) return badRequest(`Item code "${d.itemCode}" already exists.`);

  // Validate category if provided
  if (d.categoryId) {
    const cat = await db.inventoryCategory.findFirst({ where: { id: d.categoryId } });
    if (!cat) return badRequest("Selected category does not exist.");
  }

  // Validate reorder fields
  let reorderLevel = "0";
  let reorderQuantity = "0";
  try {
    reorderLevel = validateReorderLevel(d.reorderLevel ?? "0");
    reorderQuantity = validateReorderLevel(d.reorderQuantity ?? "0");
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Invalid reorder values.");
  }

  const created = await db.inventoryItem.create({
    data: {
      itemCode: d.itemCode.trim(),
      name: d.name.trim(),
      description: d.description?.trim() || null,
      categoryId: d.categoryId || null,
      unitOfMeasure: d.unitOfMeasure?.trim() || "unit",
      reorderLevel,
      reorderQuantity,
      active: d.active ?? true,
      createdById: auth.ctx.userId,
      updatedById: auth.ctx.userId,
    },
    include: { category: { select: { id: true, name: true } } },
  });

  await auditFromCtx(auth.ctx, {
    action: "create",
    module: "inventory",
    recordId: created.id,
    recordType: "InventoryItem",
    description: `Created inventory item ${created.itemCode} (${created.name})`,
    newValue: { itemCode: created.itemCode, name: created.name },
  });

  return ok(created, 201);
}
