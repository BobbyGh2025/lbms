// ============================================================================
// LBMS CRM API — Archive customer
// ----------------------------------------------------------------------------
// POST /api/customers/[id]/archive   soft-archive a customer: set
//                                    status="archived" + deletedAt=now. Block
//                                    if the customer has any posted journals
//                                    (financial history must be preserved).
//                                    Requires customers:delete OR customers:edit.
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
 * Resolve authorization for archive. Accepts either customers:delete OR
 * customers:edit (per spec). Returns the first successful auth context,
 * or the original failure response if neither permission is held.
 */
async function authorizeArchive(): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }
> {
  let auth = await authorize("customers", "delete");
  if (auth.ok) return auth;
  const edit = await authorize("customers", "edit");
  if (edit.ok) return edit;
  // Return the original "delete" denial so the error stays stable.
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

  const existing = await db.customer.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Customer not found.");

  if (existing.status === "archived" || existing.deletedAt) {
    return badRequest("Customer is already archived.");
  }

  // Block archiving while there are posted journals — the customer is
  // referenced by financial history that must remain queryable.
  const postedJournalCount = await db.journal.count({
    where: { customerId: id, status: "posted" },
  });
  if (postedJournalCount > 0) {
    return badRequest(
      `Cannot archive a customer with ${postedJournalCount} posted journal(s). Void or reverse them first.`,
      { postedJournalCount },
    );
  }

  const updated = await db.customer.update({
    where: { id },
    data: {
      status: "archived",
      deletedAt: new Date(),
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "delete",
    module: "customers",
    recordId: updated.id,
    recordType: "Customer",
    description: `Archived customer ${updated.customerNumber}${
      parsed.data.reason ? ` — reason: ${parsed.data.reason}` : ""
    }`,
    previousValue: existing,
    newValue: updated,
  });

  return ok({ id: updated.id, archived: true, status: updated.status });
}
