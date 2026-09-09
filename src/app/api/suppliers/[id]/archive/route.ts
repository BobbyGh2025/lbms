// ============================================================================
// LBMS CRM API — Archive supplier
// ----------------------------------------------------------------------------
// POST /api/suppliers/[id]/archive   soft-archive a supplier: set
//                                    status="archived" + deletedAt=now. Block
//                                    if the supplier has any posted journals
//                                    (financial history must be preserved).
//                                    Requires suppliers:delete OR suppliers:edit.
//                                    Audit recorded. Never hard-deletes.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
  badRequest,
  notFound,
  auditFromCtx,
  notDeleted,
  type AuthContext,
} from "@/lib/api-helpers";
import type { NextResponse } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ArchiveSchema = z.object({
  reason: z.string().max(500).optional(),
});

/**
 * Resolve authorization for archive. Accepts either suppliers:delete OR
 * suppliers:edit (per spec). Returns the first successful auth context,
 * or the original failure response if neither permission is held.
 */
async function authorizeArchive(): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }
> {
  let auth = await authorize("suppliers", "delete");
  if (auth.ok) return auth;
  const edit = await authorize("suppliers", "edit");
  if (edit.ok) return edit;
  return auth;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await authorizeArchive();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = ArchiveSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }

  const existing = await db.supplier.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Supplier not found.");

  if (existing.status === "archived" || existing.deletedAt) {
    return badRequest("Supplier is already archived.");
  }

  // Block archiving while there are posted journals — the supplier is
  // referenced by financial history that must remain queryable.
  const postedJournalCount = await db.journal.count({
    where: { supplierId: id, status: "posted" },
  });
  if (postedJournalCount > 0) {
    return badRequest(
      `Cannot archive a supplier with ${postedJournalCount} posted journal(s). Void or reverse them first.`,
      { postedJournalCount },
    );
  }

  const updated = await db.supplier.update({
    where: { id },
    data: {
      status: "archived",
      deletedAt: new Date(),
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "delete",
    module: "suppliers",
    recordId: updated.id,
    recordType: "Supplier",
    description: `Archived supplier ${updated.supplierNumber}${
      parsed.data.reason ? ` — reason: ${parsed.data.reason}` : ""
    }`,
    previousValue: existing,
    newValue: updated,
  });

  return ok({ id: updated.id, archived: true, status: updated.status });
}
