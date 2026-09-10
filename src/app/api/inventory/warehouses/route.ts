// ============================================================================
// LBMS Phase 8 API — Warehouses collection + single
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, ok, badRequest, notFound, auditFromCtx, notDeleted } from "@/lib/api-helpers";

// GET /api/inventory/warehouses
export async function GET(req: NextRequest) {
  const auth = await authorize("inventory", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const active = sp.get("active")?.trim();

  const where: Record<string, unknown> = {
    ...notDeleted(),
    ...(active === "true" ? { active: true } : active === "false" ? { active: false } : {}),
  };

  const warehouses = await db.warehouse.findMany({
    where,
    orderBy: { code: "asc" },
    include: { _count: { select: { stockBalances: true, movements: true } } },
  });
  return ok({ items: warehouses });
}

// POST /api/inventory/warehouses
const CreateWhSchema = z.object({
  code: z.string().min(1, "Warehouse code is required").max(50),
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).optional(),
  location: z.string().max(500).optional(),
  active: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("inventory", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = CreateWhSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);

  const existing = await db.warehouse.findUnique({ where: { code: parsed.data.code } });
  if (existing) return badRequest(`Warehouse code "${parsed.data.code}" already exists.`);

  const created = await db.warehouse.create({
    data: {
      code: parsed.data.code.trim(),
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
      location: parsed.data.location?.trim() || null,
      active: parsed.data.active ?? true,
      createdById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "create", module: "inventory", recordId: created.id, recordType: "Warehouse",
    description: `Created warehouse ${created.code} (${created.name})`,
    newValue: created,
  });
  return ok(created, 201);
}
