// ============================================================================
// LBMS Phase 7 API — Procurement Request reject
//   POST /api/procurement/requests/[id]/reject
//   Transition: submitted → rejected. Body: { reason }.
//   Self-rejection guard. Requires `procurement:approve`.
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
} from "@/lib/api-helpers";
import { isValidRequestTransition } from "@/lib/procurement-utils";

const RejectSchema = z.object({
  reason: z.string().min(1, "Rejection reason is required").max(1000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("procurement", "approve");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.procurementRequest.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Procurement request not found.");

  const target = "rejected";
  if (existing.status === target) return badRequest("Request is already rejected.");
  if (!isValidRequestTransition(existing.status, target)) {
    return badRequest(
      `Cannot reject a ${existing.status} request. Only submitted requests may be rejected.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }
  const parsed = RejectSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }

  if (!auth.ctx.isMD && existing.submittedById && existing.submittedById === auth.ctx.userId) {
    return badRequest("You cannot reject your own submitted request.");
  }

  const now = new Date();
  const updated = await db.procurementRequest.update({
    where: { id },
    data: {
      status: target,
      rejectedAt: now,
      rejectedById: auth.ctx.userId,
      rejectedReason: parsed.data.reason.trim(),
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "reject",
    module: "procurement",
    recordId: updated.id,
    recordType: "ProcurementRequest",
    description: `Rejected procurement request ${updated.requestNumber}: ${parsed.data.reason}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, rejectedReason: parsed.data.reason },
  });

  return ok(updated);
}
