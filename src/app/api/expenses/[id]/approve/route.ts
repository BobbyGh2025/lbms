// ============================================================================
// LBMS Phase 11 API — Expense approve
//   POST /api/expenses/[id]/approve
//   Transition: submitted → approved. Records approvedAt + approvedById.
//   Requires `expenses:approve`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx,
} from "@/lib/api-helpers";
import { isValidExpenseTransition } from "@/lib/ap-utils";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("expenses", "approve");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.expense.findFirst({
    where: { id },
    select: { id: true, expenseNumber: true, status: true },
  });
  if (!existing) return notFound("Expense not found.");

  const target = "approved";
  if (existing.status === target) return badRequest("Expense has already been approved.");
  if (!isValidExpenseTransition(existing.status, target)) {
    return badRequest(
      `Cannot approve a ${existing.status} expense. Only submitted expenses may be approved.`,
    );
  }

  const now = new Date();
  const updated = await db.expense.update({
    where: { id },
    data: {
      status: target,
      approvedAt: now,
      approvedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "approve",
    module: "expenses",
    recordId: updated.id,
    recordType: "Expense",
    description: `Approved expense ${updated.expenseNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, approvedAt: now, approvedById: auth.ctx.userId },
  });

  return ok(updated);
}
