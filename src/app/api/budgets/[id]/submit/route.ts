// ============================================================================
// LBMS Phase 12 API — Budget submit
//   POST /api/budgets/[id]/submit
//   Transition: draft → submitted. Records submittedAt + submittedById.
//   Requires `budgets:submit`.
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

  const target = "submitted";
  if (existing.status === target) {
    return badRequest("Budget has already been submitted.");
  }
  if (!isValidBudgetTransition(existing.status, target)) {
    return badRequest(
      `Cannot submit a ${existing.status} budget. Only draft budgets may be submitted.`,
    );
  }

  if (existing._count.lines === 0) {
    return badRequest("Cannot submit a budget with no lines.");
  }

  const now = new Date();
  const updated = await db.budget.update({
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
    module: "budgets",
    recordId: updated.id,
    recordType: "Budget",
    description: `Submitted budget ${updated.budgetNumber} for approval (total ${existing.totalAmount})`,
    previousValue: { status: existing.status },
    newValue: {
      status: updated.status,
      submittedAt: now,
      submittedById: auth.ctx.userId,
    },
  });

  return ok(updated);
}
