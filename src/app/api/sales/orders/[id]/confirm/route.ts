// ============================================================================
// LBMS Phase 10 API — Sales Order confirm
//   POST /api/sales/orders/[id]/confirm
//   Transition: draft → confirmed. Records confirmedAt + confirmedById.
//   Requires `sales:approve`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { isValidOrderTransition } from "@/lib/sales-utils";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "approve");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.salesOrder.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, orderNumber: true, status: true },
  });
  if (!existing) return notFound("Sales order not found.");

  const target = "confirmed";
  if (existing.status === target) return badRequest("Sales order is already confirmed.");
  if (!isValidOrderTransition(existing.status, target)) {
    return badRequest(
      `Cannot confirm a ${existing.status} sales order. Only draft orders may be confirmed.`,
    );
  }

  const now = new Date();
  const updated = await db.salesOrder.update({
    where: { id },
    data: {
      status: target,
      confirmedAt: now,
      confirmedById: auth.ctx.userId,
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "approve",
    module: "sales",
    recordId: updated.id,
    recordType: "SalesOrder",
    description: `Confirmed sales order ${updated.orderNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, confirmedAt: now, confirmedById: auth.ctx.userId },
  });

  return ok(updated);
}
