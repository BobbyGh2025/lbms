// ============================================================================
// LBMS Phase 12 API — Budget approve (CONCURRENCY-SAFE)
// ----------------------------------------------------------------------------
// POST /api/budgets/[id]/approve
//   Transition: submitted → approved. Records approvedAt + approvedById.
//   Requires `budgets:approve`.
//
//   CONCURRENCY FIX: Uses atomic conditional update — the UPDATE itself
//   includes a WHERE status = "submitted" condition. If a concurrent request
//   already changed the status, the update affects 0 rows, and we detect
//   this and return 400 (already approved/changed). This is safe under both
//   SQLite and PostgreSQL without needing row-level locking.
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

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("budgets", "approve");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.budget.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true,
      budgetNumber: true,
      status: true,
      totalAmount: true,
      submittedAt: true,
    },
  });
  if (!existing) return notFound("Budget not found.");

  if (existing.status !== "submitted") {
    return badRequest(
      `Cannot approve a ${existing.status} budget. Only submitted budgets may be approved.`,
    );
  }

  const now = new Date();

  // ATOMIC CONDITIONAL UPDATE: only updates if status is still "submitted".
  // If a concurrent request already changed it, count = 0 → we return 400.
  const result = await db.budget.updateMany({
    where: { id, status: "submitted" },
    data: {
      status: "approved",
      approvedAt: now,
      approvedById: auth.ctx.userId,
      updatedById: auth.ctx.userId,
    },
  });

  if (result.count === 0) {
    // Concurrent request already changed the status
    return badRequest("Budget status has changed. It may have already been approved.");
  }

  // Fetch the updated record for the response
  const updated = await db.budget.findUnique({
    where: { id },
    select: {
      id: true,
      budgetNumber: true,
      name: true,
      description: true,
      fiscalYear: true,
      startDate: true,
      endDate: true,
      status: true,
      version: true,
      currency: true,
      totalAmount: true,
      submittedAt: true,
      submittedById: true,
      approvedAt: true,
      approvedById: true,
      lockedAt: true,
      lockedById: true,
      cancelledAt: true,
      cancelledById: true,
      createdById: true,
      updatedById: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "approve",
    module: "budgets",
    recordId: updated!.id,
    recordType: "Budget",
    description: `Approved budget ${updated!.budgetNumber} (total ${existing.totalAmount})`,
    previousValue: { status: existing.status },
    newValue: {
      status: updated!.status,
      approvedAt: now,
      approvedById: auth.ctx.userId,
    },
  });

  return ok(updated);
}
