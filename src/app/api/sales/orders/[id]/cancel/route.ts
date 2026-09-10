// ============================================================================
// LBMS Phase 10 API — Sales Order cancel
//   POST /api/sales/orders/[id]/cancel
//   Transitions: draft → cancelled, confirmed → cancelled, processing → cancelled.
//   Terminal state. Requires `sales:cancel`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { isValidOrderTransition, ORDER_TERMINAL } from "@/lib/sales-utils";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "cancel");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.salesOrder.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, orderNumber: true, status: true },
  });
  if (!existing) return notFound("Sales order not found.");

  const target = "cancelled";
  if (existing.status === target) return badRequest("Sales order is already cancelled.");
  if (ORDER_TERMINAL.has(existing.status) && existing.status !== "cancelled") {
    return badRequest(`Cannot cancel a ${existing.status} sales order (terminal state).`);
  }
  if (!isValidOrderTransition(existing.status, target)) {
    return badRequest(`Cannot cancel a ${existing.status} sales order.`);
  }

  const updated = await db.salesOrder.update({
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
    recordType: "SalesOrder",
    description: `Cancelled sales order ${updated.orderNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status },
  });

  return ok(updated);
}
