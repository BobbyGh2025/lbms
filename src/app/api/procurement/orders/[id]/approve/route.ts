// ============================================================================
// LBMS Phase 7 API — Purchase Order approve
//   POST /api/procurement/orders/[id]/approve
//   Transition: pending_approval → approved. Records approvedAt + approvedById.
//   Self-approval guard: the requester may not approve their own PO unless MD.
//   Requires `procurement:approve`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { isValidPurchaseOrderTransition } from "@/lib/procurement-utils";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("procurement", "approve");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.purchaseOrder.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Purchase order not found.");

  const target = "approved";
  if (existing.status === target) return badRequest("Purchase order is already approved.");
  if (!isValidPurchaseOrderTransition(existing.status, target)) {
    return badRequest(
      `Cannot approve a ${existing.status} purchase order. Only pending_approval POs may be approved.`,
    );
  }

  // Self-approval guard (MD bypasses).
  if (!auth.ctx.isMD && existing.requestedById === auth.ctx.userId) {
    return badRequest("You cannot approve your own purchase order.");
  }

  // An approved PO should have at least one item to be meaningful, but we do
  // not hard-block — the spec says "do not add fields without a business
  // purpose", and an empty approved PO is valid as a placeholder.

  const now = new Date();
  const updated = await db.purchaseOrder.update({
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
    recordType: "PurchaseOrder",
    description: `Approved purchase order ${updated.purchaseOrderNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, approvedAt: now, approvedById: auth.ctx.userId },
  });

  return ok(updated);
}
