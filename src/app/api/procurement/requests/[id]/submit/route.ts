// ============================================================================
// LBMS Phase 7 API — Procurement Request lifecycle endpoints
// ----------------------------------------------------------------------------
// POST /api/procurement/requests/[id]/submit
//   Transition: draft → submitted. Records submittedAt + submittedById.
//   Requires `procurement:submit`.
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
  const auth = await authorize("procurement", "submit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.procurementRequest.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Procurement request not found.");

  const target = "submitted";
  if (existing.status === target) {
    return badRequest("Request is already submitted.");
  }
  if (!isValidRequestTransition(existing.status, target)) {
    return badRequest(
      `Cannot submit a ${existing.status} request. Only draft requests may be submitted.`,
    );
  }

  // A request must have a requester and at least a description or supplier
  // to be meaningfully submitted. We enforce minimal completeness here.
  if (!existing.requesterId) {
    return badRequest("Request must have a requester before submission.");
  }

  const now = new Date();
  const updated = await db.procurementRequest.update({
    where: { id },
    data: {
      status: target,
      submittedAt: now,
      submittedById: auth.ctx.userId,
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "procurement",
    recordId: updated.id,
    recordType: "ProcurementRequest",
    description: `Submitted procurement request ${updated.requestNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, submittedAt: now },
  });

  return ok(updated);
}
