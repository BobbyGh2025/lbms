// ============================================================================
// LBMS Phase 8 API — Warehouse single-record (GET + PATCH)
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, ok, badRequest, notFound, auditFromCtx, notDeleted } from "@/lib/api-helpers";

const PatchWhSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  location: z.string().max(500).optional(),
  active: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

// GET
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorize("inventory", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const wh = await db.warehouse.findFirst({
    where: { id, ...notDeleted() },
    include: {
      createdBy: { select: { id: true, username: true } },
      stockBalances: {
        include: { inventoryItem: { select: { id: true, itemCode: true, name: true, unitOfMeasure: true, reorderLevel: true } } },
      },
      movements: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          inventoryItem: { select: { id: true, itemCode: true, name: true } },
          performedBy: { select: { id: true, username: true } },
        },
      },
      _count: { select: { movements: true, stockBalances: true } },
    },
  });
  if (!wh) return notFound("Warehouse not found.");
  return ok(wh);
}

// PATCH
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorize("inventory", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.warehouse.findFirst({ where: { id, ...notDeleted() } });
  if (!existing) return notFound("Warehouse not found.");

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = PatchWhSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);

  const d = parsed.data;
  const updated = await db.warehouse.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name.trim() } : {}),
      ...(d.description !== undefined ? { description: d.description?.trim() || null } : {}),
      ...(d.location !== undefined ? { location: d.location?.trim() || null } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update", module: "inventory", recordId: updated.id, recordType: "Warehouse",
    description: `Updated warehouse ${updated.code} (${updated.name})`,
    previousValue: existing, newValue: updated,
  });
  return ok(updated);
}
