// ============================================================================
// LBMS Phase 8 API — Inventory Categories collection + single
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, ok, badRequest, notFound, auditFromCtx } from "@/lib/api-helpers";

// GET /api/inventory/categories
export async function GET() {
  const auth = await authorize("inventory", "view");
  if (!auth.ok) return auth.response;

  const categories = await db.inventoryCategory.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { items: true } } },
  });
  return ok({ items: categories });
}

// POST /api/inventory/categories
const CreateCatSchema = z.object({
  name: z.string().min(1, "Category name is required").max(100),
  description: z.string().max(1000).optional(),
  active: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("inventory", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = CreateCatSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);

  const existing = await db.inventoryCategory.findUnique({ where: { name: parsed.data.name } });
  if (existing) return badRequest(`Category "${parsed.data.name}" already exists.`);

  const created = await db.inventoryCategory.create({
    data: {
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
      active: parsed.data.active ?? true,
      createdById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "create", module: "inventory", recordId: created.id, recordType: "InventoryCategory",
    description: `Created inventory category ${created.name}`,
    newValue: created,
  });
  return ok(created, 201);
}
