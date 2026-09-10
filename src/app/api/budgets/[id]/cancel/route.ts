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
  const updated = await db.budget.update({
    where: { id },
    data: {
      status: target,
      cancelledAt: now,
      cancelledById: auth.ctx.userId,
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "budgets",
    recordId: updated.id,
    recordType: "Budget",
    description: `Cancelled budget ${updated.budgetNumber} from ${existing.status} state${d.reason ? ` — reason: ${d.reason}` : ""}`,
    previousValue: { status: existing.status },
    newValue: {
      status: updated.status,
      cancelledAt: now,
      cancelledById: auth.ctx.userId,
      reason: d.reason ?? null,
    },
  });

  return ok(updated);
}
