// ============================================================================
// LBMS Phase 7 API — Purchase Order send / cancel / close
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { isValidPurchaseOrderTransition, PO_TERMINAL_STATUSES } from "@/lib/procurement-utils";

// ---------------------------------------------------------------------------
// POST /api/procurement/orders/[id]/send
//   Transition: approved → sent. Records sentAt. Requires `procurement:edit`.
// ---------------------------------------------------------------------------
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("procurement", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.purchaseOrder.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Purchase order not found.");

  const target = "sent";
  if (existing.status === target) return badRequest("Purchase order is already sent.");
  if (!isValidPurchaseOrderTransition(existing.status, target)) {
    return badRequest(
      `Cannot send a ${existing.status} purchase order. Only approved POs may be sent.`,
    );
  }

  const now = new Date();
  const updated = await db.purchaseOrder.update({
    where: { id },
    data: { status: target, sentAt: now, updatedById: auth.ctx.userId },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "procurement",
    recordId: updated.id,
    recordType: "PurchaseOrder",
    description: `Sent purchase order ${updated.purchaseOrderNumber} to supplier`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, sentAt: now },
  });

  return ok(updated);
}
