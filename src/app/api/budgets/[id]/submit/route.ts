// ============================================================================
// LBMS Phase 12 API — Budget submit (CONCURRENCY-SAFE)
// ----------------------------------------------------------------------------
// POST /api/budgets/[id]/submit
//   Transition: draft → submitted. Records submittedAt + submittedById.
//   Requires `budgets:submit`.
//
//   CONCURRENCY FIX: Uses atomic conditional update — the UPDATE itself
//   includes a WHERE status = "draft" condition.
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
  const auth = await authorize("budgets", "submit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.budget.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true,
      budgetNumber: true,
      status: true,
      totalAmount: true,
      _count: { select: { lines: true } },
    },
  });
  if (!existing) return notFound("Budget not found.");

  if (existing.status !== "draft") {
    return badRequest(
      `Cannot submit a ${existing.status} budget. Only draft budgets may be submitted.`,
    );
  }

  if (existing._count.lines === 0) {
    return badRequest("Cannot submit a budget with no lines.");
  }

  const now = new Date();

  // ATOMIC CONDITIONAL UPDATE: only updates if status is still "draft".
  const result = await db.budget.updateMany({
    where: { id, status: "draft" },
    data: {
      status: "submitted",
      submittedAt: now,
      submittedById: auth.ctx.userId,
      updatedById: auth.ctx.userId,
    },
  });

  if (result.count === 0) {
    return badRequest("Budget status has changed. It may have already been submitted.");
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
    description: `Submitted budget ${updated!.budgetNumber} (total ${existing.totalAmount}, ${existing._count.lines} lines)`,
    previousValue: { status: existing.status },
    newValue: {
      status: updated!.status,
      submittedAt: now,
      submittedById: auth.ctx.userId,
    },
  });

  return ok(updated);
}
