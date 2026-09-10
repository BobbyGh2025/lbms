// ============================================================================
// LBMS Phase 7 API — Procurement Request cancel
//   POST /api/procurement/requests/[id]/cancel
//   Transition: draft/submitted/approved → cancelled.
//   Cannot cancel an already-converted request. Requires `procurement:cancel`.
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
  const auth = await authorize("procurement", "cancel");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.procurementRequest.findFirst({
    where: { id, ...notDeleted() },
    include: { convertedPurchaseOrder: { select: { id: true, purchaseOrderNumber: true } } },
  });
  if (!existing) return notFound("Procurement request not found.");

  const target = "cancelled";
  if (existing.status === target) return badRequest("Request is already cancelled.");
  if (!isValidRequestTransition(existing.status, target)) {
    return badRequest(`Cannot cancel a ${existing.status} request.`);
  }
  if (existing.convertedPurchaseOrder) {
    return badRequest(
      `Cannot cancel: this request has already been converted to PO ${existing.convertedPurchaseOrder.purchaseOrderNumber}.`,
    );
  }

  const now = new Date();
  const updated = await db.procurementRequest.update({
    where: { id },
    data: {
      status: target,
      cancelledAt: now,
      cancelledById: auth.ctx.userId,
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "procurement",
    recordId: updated.id,
    recordType: "ProcurementRequest",
    description: `Cancelled procurement request ${updated.requestNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, cancelledAt: now },
  });

  return ok(updated);
}
