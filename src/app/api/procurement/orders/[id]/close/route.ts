// ============================================================================
// LBMS Phase 7 API — Purchase Order close
//   POST /api/procurement/orders/[id]/close
//   Transition: partially_received/received → closed. Records closedAt.
//   Requires `procurement:edit`.
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
  const auth = await authorize("procurement", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.purchaseOrder.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Purchase order not found.");

  const target = "closed";
  if (existing.status === target) return badRequest("Purchase order is already closed.");
  if (!isValidPurchaseOrderTransition(existing.status, target)) {
    return badRequest(
      `Cannot close a ${existing.status} purchase order. Only partially_received or received POs may be closed.`,
    );
  }

  const now = new Date();
  const updated = await db.purchaseOrder.update({
    where: { id },
    data: { status: target, closedAt: now, updatedById: auth.ctx.userId },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "procurement",
    recordId: updated.id,
    recordType: "PurchaseOrder",
    description: `Closed purchase order ${updated.purchaseOrderNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, closedAt: now },
  });

  return ok(updated);
}
