// ============================================================================
// LBMS Phase 12 API — Budget single-record
// ----------------------------------------------------------------------------
// GET   /api/budgets/[id]   fetch one budget with lines + lifecycle metadata +
//   derived totals (income/expense split, line count).
// PATCH /api/budgets/[id]   edit a DRAFT budget only. budgetNumber, fiscalYear,
//   status, totalAmount are NEVER client-controlled. Recomputes totalAmount
//   server-side after edits. Requires `budgets:edit`.
//
// Budget = planning record. No journal/JournalEntry interactions here.
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
import {
  BUDGET_EDITABLE,
  BUDGET_TERMINAL,
  recomputeBudgetTotal,
} from "@/lib/budget-utils";
import { toMoney, serializeMoney, ZERO } from "@/lib/finance/money";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const PatchBudgetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  currency: z.string().max(3).optional(),
});

// ---------------------------------------------------------------------------
// GET /api/budgets/[id]
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("budgets", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const budget = await db.budget.findFirst({
    where: { id, ...notDeleted() },
    include: {
      submittedBy: { select: { id: true, username: true } },
      approvedBy: { select: { id: true, username: true } },
      lockedBy: { select: { id: true, username: true } },
      createdBy: { select: { id: true, username: true } },
      updatedBy: { select: { id: true, username: true } },
      lines: {
        orderBy: [{ ledgerAccountCode: "asc" }, { month: "asc" }],
        include: {
          department: { select: { id: true, name: true, code: true } },
          project: { select: { id: true, projectNumber: true, name: true } },
        },
      },
    },
  });
  if (!budget) return notFound("Budget not found.");

  // Derive income/expense split (computed from lines).
  let incomeTotal = ZERO;
  let expenseTotal = ZERO;
  for (const ln of budget.lines) {
    const amt = toMoney(ln.amount);
    if (ln.accountClass === "income") incomeTotal = incomeTotal.plus(amt);
    else if (ln.accountClass === "expense") expenseTotal = expenseTotal.plus(amt);
  }

  return ok({
    ...budget,
    totalIncome: serializeMoney(incomeTotal),
    totalExpense: serializeMoney(expenseTotal),
    lineCount: budget.lines.length,
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/budgets/[id]
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("budgets", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.budget.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true,
      budgetNumber: true,
      status: true,
      startDate: true,
      endDate: true,
    },
  });
  if (!existing) return notFound("Budget not found.");

  if (!BUDGET_EDITABLE.has(existing.status)) {
    if (BUDGET_TERMINAL.has(existing.status)) {
      return badRequest(`Cannot edit a ${existing.status} budget.`);
    }
    return badRequest(
      `Cannot edit a ${existing.status} budget. Only draft budgets may be edited.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = PatchBudgetSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(
      parsed.error.issues[0]?.message ?? "Validation failed",
      parsed.error.issues,
    );
  }
  const d = parsed.data;

  const data: Record<string, unknown> = { updatedById: auth.ctx.userId };
  if (d.name !== undefined) data.name = d.name.trim();
  if (d.description !== undefined) data.description = d.description?.trim() || null;
  if (d.currency !== undefined) data.currency = d.currency.toUpperCase();
  if (d.startDate !== undefined) data.startDate = new Date(d.startDate);
  if (d.endDate !== undefined) data.endDate = new Date(d.endDate);

  // Validate end > start (use merged values).
  const mergedStart = data.startDate ? (data.startDate as Date) : existing.startDate;
  const mergedEnd = data.endDate ? (data.endDate as Date) : existing.endDate;
  if (mergedEnd <= mergedStart) {
    return badRequest("End date must be after start date.");
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      const u = await tx.budget.update({ where: { id }, data });
      // Recompute totalAmount (server-authoritative).
      const totalStr = await recomputeBudgetTotal(tx, id);
      const finalBudget = await tx.budget.update({
        where: { id },
        data: { totalAmount: totalStr },
        include: {
          submittedBy: { select: { id: true, username: true } },
          approvedBy: { select: { id: true, username: true } },
          lockedBy: { select: { id: true, username: true } },
          createdBy: { select: { id: true, username: true } },
          lines: {
            orderBy: [{ ledgerAccountCode: "asc" }, { month: "asc" }],
            include: {
              department: { select: { id: true, name: true, code: true } },
              project: { select: { id: true, projectNumber: true, name: true } },
            },
          },
        },
      });
      return { finalBudget, totalStr };
    });

    await auditFromCtx(auth.ctx, {
      action: "update",
      module: "budgets",
      recordId: updated.finalBudget.id,
      recordType: "Budget",
      description: `Updated budget ${updated.finalBudget.budgetNumber}`,
      previousValue: { status: existing.status },
      newValue: {
        ...updated.finalBudget,
        totalAmount: updated.totalStr,
      },
    });

    return ok(updated.finalBudget);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A constraint error occurred. Please retry.");
    }
    throw err;
  }
}
