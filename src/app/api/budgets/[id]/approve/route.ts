// ============================================================================
// LBMS Phase 12 API — Budget approve
//   POST /api/budgets/[id]/approve
//   Transition: submitted → approved. Records approvedAt + approvedById.
//   Requires `budgets:approve`.
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
import { isValidBudgetTransition } from "@/lib/budget-utils";

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

  const target = "approved";
  if (existing.status === target) {
    return badRequest("Budget has already been approved.");
  }
  if (!isValidBudgetTransition(existing.status, target)) {
    return badRequest(
      `Cannot approve a ${existing.status} budget. Only submitted budgets may be approved.`,
    );
  }

  const now = new Date();
  const updated = await db.budget.update({
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
    module: "budgets",
    recordId: updated.id,
    recordType: "Budget",
    description: `Approved budget ${updated.budgetNumber} (total ${existing.totalAmount})`,
    previousValue: { status: existing.status },
    newValue: {
      status: updated.status,
      approvedAt: now,
      approvedById: auth.ctx.userId,
    },
  });

  return ok(updated);
}
