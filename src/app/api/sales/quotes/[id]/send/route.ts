// ============================================================================
// LBMS Phase 10 API — Quote send
//   POST /api/sales/quotes/[id]/send
//   Transition: draft → sent. Records sentAt. Requires `sales:edit`.
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
  const auth = await authorize("sales", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.quote.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, quoteNumber: true, status: true },
  });
  if (!existing) return notFound("Quote not found.");

  const target = "sent";
  if (existing.status === target) return badRequest("Quote has already been sent.");
  if (!isValidQuoteTransition(existing.status, target)) {
    return badRequest(
      `Cannot send a ${existing.status} quote. Only draft quotes may be sent.`,
    );
  }

  const now = new Date();
  const updated = await db.quote.update({
    where: { id },
    data: {
      status: target,
      sentAt: now,
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "sales",
    recordId: updated.id,
    recordType: "Quote",
    description: `Sent quote ${updated.quoteNumber} to customer`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, sentAt: now },
  });

  return ok(updated);
}
