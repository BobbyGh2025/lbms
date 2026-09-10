// ============================================================================
// LBMS Phase 12 API — Budget lock (CONCURRENCY-SAFE)
// ----------------------------------------------------------------------------
// POST /api/budgets/[id]/lock
//   Transition: approved → locked. Records lockedAt + lockedById.
//   Requires `budgets:lock`.
//
//   CONCURRENCY FIX: Uses atomic conditional update — the UPDATE itself
//   includes a WHERE status = "approved" condition.
// ============================================================================

import { NextRequest } from "next/server";
import type { PermissionAction } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
  badRequest,
  notFound,
  auditFromCtx,
  notDeleted,
} from "@/lib/api-helpers";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("budgets", "lock" as PermissionAction);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.budget.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true,
      budgetNumber: true,
      status: true,
      totalAmount: true,
      approvedAt: true,
    },
  });
  if (!existing) return notFound("Budget not found.");

  if (existing.status !== "approved") {
    return badRequest(
      `Cannot lock a ${existing.status} budget. Only approved budgets may be locked.`,
    );
  }

  const now = new Date();

  // ATOMIC CONDITIONAL UPDATE: only updates if status is still "approved".
  const result = await db.budget.updateMany({
    where: { id, status: "approved" },
    data: {
      status: "locked",
      lockedAt: now,
      lockedById: auth.ctx.userId,
      updatedById: auth.ctx.userId,
    },
  });

  if (result.count === 0) {
    return badRequest("Budget status has changed. It may have already been locked.");
  }

  const updated = await db.budget.findUnique({
    where: { id },
    select: {
      id: true, budgetNumber: true, name: true, description: true,
      fiscalYear: true, startDate: true, endDate: true, status: true,
      version: true, currency: true, totalAmount: true,
      submittedAt: true, submittedById: true,
      approvedAt: true, approvedById: true,
      lockedAt: true, lockedById: true,
      cancelledAt: true, cancelledById: true,
      createdById: true, updatedById: true,
      createdAt: true, updatedAt: true, deletedAt: true,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "budgets",
    recordId: updated!.id,
    recordType: "Budget",
    description: `Locked budget ${updated!.budgetNumber} (total ${existing.totalAmount})`,
    previousValue: { status: existing.status },
    newValue: {
      status: updated!.status,
      lockedAt: now,
      lockedById: auth.ctx.userId,
    },
  });

  return ok(updated);
}
