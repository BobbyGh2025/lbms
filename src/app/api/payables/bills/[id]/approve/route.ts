// ============================================================================
// LBMS Phase 11 API — Supplier Bill approve
//   POST /api/payables/bills/[id]/approve
//   Transition: submitted → approved. Records approvedAt + approvedById.
//   Requires `payables:approve`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { isValidBillTransition } from "@/lib/ap-utils";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("payables", "approve");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.supplierBill.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, billNumber: true, status: true },
  });
  if (!existing) return notFound("Supplier bill not found.");

  const target = "approved";
  if (existing.status === target) return badRequest("Bill has already been approved.");
  if (!isValidBillTransition(existing.status, target)) {
    return badRequest(
      `Cannot approve a ${existing.status} bill. Only submitted bills may be approved.`,
    );
  }

  const now = new Date();
  const updated = await db.supplierBill.update({
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
    module: "payables",
    recordId: updated.id,
    recordType: "SupplierBill",
    description: `Approved bill ${updated.billNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, approvedAt: now, approvedById: auth.ctx.userId },
  });

  return ok(updated);
}
