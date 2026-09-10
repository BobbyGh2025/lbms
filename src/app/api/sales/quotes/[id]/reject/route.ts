// ============================================================================
// LBMS Phase 10 API — Quote reject
//   POST /api/sales/quotes/[id]/reject
//   Transition: sent → rejected. Terminal state. Requires `sales:reject`.
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
  const auth = await authorize("sales", "reject");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.quote.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, quoteNumber: true, status: true },
  });
  if (!existing) return notFound("Quote not found.");

  const target = "rejected";
  if (existing.status === target) return badRequest("Quote has already been rejected.");
  if (!isValidQuoteTransition(existing.status, target)) {
    return badRequest(
      `Cannot reject a ${existing.status} quote. Only sent quotes may be rejected.`,
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
    action: "reject",
    module: "sales",
    recordId: updated.id,
    recordType: "Quote",
    description: `Rejected quote ${updated.quoteNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status },
  });

  return ok(updated);
}
