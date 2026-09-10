// ============================================================================
// LBMS Phase 7 API — Purchase Order cancel
//   POST /api/procurement/orders/[id]/cancel
//   Transition: draft/pending_approval/approved/sent/partially_received/
//               received → cancelled. Cannot cancel closed. Requires
//   `procurement:cancel`.
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
  const auth = await authorize("procurement", "cancel");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.purchaseOrder.findFirst({
    where: { id, ...notDeleted() },
    include: { _count: { select: { goodsReceipts: true } } },
  });
  if (!existing) return notFound("Purchase order not found.");

  const target = "cancelled";
  if (existing.status === target) return badRequest("Purchase order is already cancelled.");
  if (!isValidPurchaseOrderTransition(existing.status, target)) {
    return badRequest(`Cannot cancel a ${existing.status} purchase order.`);
  }

  // Guard: a PO that has already been received cannot be cancelled outright —
  // the receipts represent real goods received. Force the user to close it
  // instead (and handle any discrepancy via the future AP handoff).
  if (existing._count.goodsReceipts > 0) {
    return badRequest(
      "Cannot cancel a purchase order that has goods receipts. Close it instead.",
    );
  }

  const now = new Date();
  const updated = await db.purchaseOrder.update({
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
    recordType: "PurchaseOrder",
    description: `Cancelled purchase order ${updated.purchaseOrderNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, cancelledAt: now },
  });

  return ok(updated);
}
