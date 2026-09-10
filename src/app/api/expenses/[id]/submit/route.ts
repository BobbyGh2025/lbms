// ============================================================================
// LBMS Phase 11 API — Expense submit
//   POST /api/expenses/[id]/submit
//   Transition: draft → submitted. Records submittedAt.
//   Requires `expenses:submit`.
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
  const auth = await authorize("expenses", "submit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.expense.findFirst({
    where: { id },
    select: { id: true, expenseNumber: true, status: true },
  });
  if (!existing) return notFound("Expense not found.");

  const target = "submitted";
  if (existing.status === target) return badRequest("Expense has already been submitted.");
  if (!isValidExpenseTransition(existing.status, target)) {
    return badRequest(
      `Cannot submit a ${existing.status} expense. Only draft expenses may be submitted.`,
    );
  }

  const now = new Date();
  const updated = await db.expense.update({
    where: { id },
    data: {
      status: target,
      submittedAt: now,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "expenses",
    recordId: updated.id,
    recordType: "Expense",
    description: `Submitted expense ${updated.expenseNumber} for approval`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, submittedAt: now },
  });

  return ok(updated);
}
