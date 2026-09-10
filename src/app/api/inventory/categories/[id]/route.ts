// ============================================================================
// LBMS Phase 8 API — Inventory Category single-record (PATCH)
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, ok, badRequest, notFound, auditFromCtx } from "@/lib/api-helpers";

const PatchCatSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("inventory", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.inventoryCategory.findUnique({ where: { id } });
  if (!existing) return notFound("Category not found.");

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = PatchCatSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);

  const d = parsed.data;
  if (d.name && d.name !== existing.name) {
    const dup = await db.inventoryCategory.findUnique({ where: { name: d.name } });
    if (dup) return badRequest(`Category "${d.name}" already exists.`);
  }

  const updated = await db.inventoryCategory.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name.trim() } : {}),
      ...(d.description !== undefined ? { description: d.description?.trim() || null } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update", module: "inventory", recordId: updated.id, recordType: "InventoryCategory",
    description: `Updated inventory category ${updated.name}`,
    previousValue: existing, newValue: updated,
  });
  return ok(updated);
}
