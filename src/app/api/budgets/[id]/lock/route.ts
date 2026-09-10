// ============================================================================
// LBMS Phase 12 API — Budget lock
//   POST /api/budgets/[id]/lock
//   Transition: approved → locked. Records lockedAt + lockedById.
//   Locked budgets are IMMUTABLE (BUDGET_TERMINAL). Used for actuals comparison.
//   Requires `budgets:lock` permission (cast — the action exists in the DB
//   via Phase 12 seed but is not in the static PermissionAction type).
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
import type { PermissionAction } from "@/lib/permissions";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // "lock" is a valid budgets:* permission (seed-phase12.ts) but is not in
  // the static PermissionAction union. Cast for the type-checker; runtime
  // check uses string comparison against session.permissions.
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

  const target = "locked";
  if (existing.status === target) {
    return badRequest("Budget has already been locked.");
  }
  if (!isValidBudgetTransition(existing.status, target)) {
    return badRequest(
      `Cannot lock a ${existing.status} budget. Only approved budgets may be locked.`,
    );
  }

  const now = new Date();
  const updated = await db.budget.update({
    where: { id },
    data: {
      status: target,
      lockedAt: now,
      lockedById: auth.ctx.userId,
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "budgets",
    recordId: updated.id,
    recordType: "Budget",
    description: `Locked budget ${updated.budgetNumber} (immutable; total ${existing.totalAmount})`,
    previousValue: { status: existing.status },
    newValue: {
      status: updated.status,
      lockedAt: now,
      lockedById: auth.ctx.userId,
    },
  });

  return ok(updated);
}
