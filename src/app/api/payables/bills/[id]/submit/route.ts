// ============================================================================
// LBMS Phase 11 API — Supplier Bill submit
//   POST /api/payables/bills/[id]/submit
//   Transition: draft → submitted. Records submittedAt + submittedById.
//   Requires `payables:submit`.
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
  const auth = await authorize("payables", "submit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.supplierBill.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, billNumber: true, status: true },
  });
  if (!existing) return notFound("Supplier bill not found.");

  const target = "submitted";
  if (existing.status === target) return badRequest("Bill has already been submitted.");
  if (!isValidBillTransition(existing.status, target)) {
    return badRequest(
      `Cannot submit a ${existing.status} bill. Only draft bills may be submitted.`,
    );
  }

  const now = new Date();
  const updated = await db.supplierBill.update({
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
    module: "payables",
    recordId: updated.id,
    recordType: "SupplierBill",
    description: `Submitted bill ${updated.billNumber} for approval`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, submittedAt: now, submittedById: auth.ctx.userId },
  });

  return ok(updated);
}
