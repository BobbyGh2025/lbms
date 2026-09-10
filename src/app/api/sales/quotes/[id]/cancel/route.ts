// ============================================================================
// LBMS Phase 10 API — Quote cancel
//   POST /api/sales/quotes/[id]/cancel
//   Transitions: draft → cancelled, sent → cancelled, accepted → cancelled.
//   Requires `sales:cancel`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { isValidQuoteTransition, QUOTE_TERMINAL } from "@/lib/sales-utils";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "cancel");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.quote.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, quoteNumber: true, status: true },
  });
  if (!existing) return notFound("Quote not found.");

  const target = "cancelled";
  if (existing.status === target) return badRequest("Quote is already cancelled.");
  if (QUOTE_TERMINAL.has(existing.status) && existing.status !== "cancelled") {
    return badRequest(`Cannot cancel a ${existing.status} quote (terminal state).`);
  }
  if (!isValidQuoteTransition(existing.status, target)) {
    return badRequest(
      `Cannot cancel a ${existing.status} quote.`,
    );
  }

  const updated = await db.quote.update({
    where: { id },
    data: {
      status: target,
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "sales",
    recordId: updated.id,
    recordType: "Quote",
    description: `Cancelled quote ${updated.quoteNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status },
  });

  return ok(updated);
}
