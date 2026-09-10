// ============================================================================
// LBMS Phase 10 API — Quote accept
//   POST /api/sales/quotes/[id]/accept
//   Transition: sent → accepted. Records acceptedAt + acceptedById.
//   Requires `sales:approve`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { isValidQuoteTransition } from "@/lib/sales-utils";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "approve");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.quote.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, quoteNumber: true, status: true },
  });
  if (!existing) return notFound("Quote not found.");

  const target = "accepted";
  if (existing.status === target) return badRequest("Quote has already been accepted.");
  if (!isValidQuoteTransition(existing.status, target)) {
    return badRequest(
      `Cannot accept a ${existing.status} quote. Only sent quotes may be accepted.`,
    );
  }

  const now = new Date();
  const updated = await db.quote.update({
    where: { id },
    data: {
      status: target,
      acceptedAt: now,
      acceptedById: auth.ctx.userId,
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "approve",
    module: "sales",
    recordId: updated.id,
    recordType: "Quote",
    description: `Accepted quote ${updated.quoteNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, acceptedAt: now, acceptedById: auth.ctx.userId },
  });

  return ok(updated);
}
