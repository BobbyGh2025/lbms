// ============================================================================
// LBMS Phase 7 API — Procurement Request approve
//   POST /api/procurement/requests/[id]/approve
//   Transition: submitted → approved. Records approvedAt + approvedById.
//   Self-approval guard: the submitter may not approve their own submission
//   unless they are MD. Requires `procurement:approve`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
  badRequest,
  notFound,
  auditFromCtx,
  notDeleted,
} from "@/lib/api-helpers";
import { isValidRequestTransition } from "@/lib/procurement-utils";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("procurement", "approve");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.procurementRequest.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Procurement request not found.");

  const target = "approved";
  if (existing.status === target) return badRequest("Request is already approved.");
  if (!isValidRequestTransition(existing.status, target)) {
    return badRequest(
      `Cannot approve a ${existing.status} request. Only submitted requests may be approved.`,
    );
  }

  // Self-approval guard (MD bypasses).
  if (!auth.ctx.isMD && existing.submittedById && existing.submittedById === auth.ctx.userId) {
    return badRequest("You cannot approve your own submitted request.");
  }

  const now = new Date();
  const updated = await db.procurementRequest.update({
    where: { id },
    data: {
      status: target,
      approvedAt: now,
      approvedById: auth.ctx.userId,
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "approve",
    module: "procurement",
    recordId: updated.id,
    recordType: "ProcurementRequest",
    description: `Approved procurement request ${updated.requestNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, approvedAt: now, approvedById: auth.ctx.userId },
  });

  return ok(updated);
}
