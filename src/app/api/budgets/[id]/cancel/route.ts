// ============================================================================
// LBMS Phase 12 API — Budget cancel
//   POST /api/budgets/[id]/cancel
//   Transition: any non-terminal state → cancelled. Records cancelledAt +
//   cancelledById (note: schema does not include cancelledBy FK, but the
//   audit log captures the actor).
//   Cancelled budgets are IMMUTABLE (BUDGET_TERMINAL).
//   Optional `reason` field. Requires `budgets:cancel`.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
  badRequest,
  notFound,
  auditFromCtx,
  notDeleted,
} from "@/lib/api-helpers";
import { BUDGET_TERMINAL, isValidBudgetTransition } from "@/lib/budget-utils";

const CancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("budgets", "cancel");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.budget.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true,
      budgetNumber: true,
      status: true,
      totalAmount: true,
    },
  });
  if (!existing) return notFound("Budget not found.");

  const target = "cancelled";
  if (existing.status === target) {
    return badRequest("Budget has already been cancelled.");
  }
  if (BUDGET_TERMINAL.has(existing.status)) {
    return badRequest(
      `Cannot cancel a ${existing.status} budget (terminal state).`,
    );
  }
  if (!isValidBudgetTransition(existing.status, target)) {
    return badRequest(
      `Cannot cancel a ${existing.status} budget.`,
    );
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* OK — body is optional */
  }
  const parsed = CancelSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(
      parsed.error.issues[0]?.message ?? "Validation failed",
      parsed.error.issues,
    );
  }
  const d = parsed.data;

  const now = new Date();

  // ATOMIC CONDITIONAL UPDATE: only updates if status is not terminal.
  const result = await db.budget.updateMany({
    where: { id, status: { notIn: ["locked", "cancelled"] } },
    data: {
      status: target,
      cancelledAt: now,
      cancelledById: auth.ctx.userId,
      updatedById: auth.ctx.userId,
    },
  });

  if (result.count === 0) {
    return badRequest("Budget status has changed or is in a terminal state.");
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
    description: `Cancelled budget ${updated!.budgetNumber} from ${existing.status} state${d.reason ? ` — reason: ${d.reason}` : ""}`,
    previousValue: { status: existing.status },
    newValue: {
      status: updated!.status,
      cancelledAt: now,
      cancelledById: auth.ctx.userId,
      reason: d.reason ?? null,
    },
  });

  return ok(updated);
}
