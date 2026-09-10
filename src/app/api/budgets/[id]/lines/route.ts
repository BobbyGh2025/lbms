// ============================================================================
// LBMS Phase 12 API — Budget Lines collection
// ----------------------------------------------------------------------------
// POST /api/budgets/[id]/lines   add a line to a budget. Only allowed while the
//   budget is in DRAFT (BUDGET_EDITABLE = {"draft"}).
//
//   Validates:
//     - ledgerAccountCode EXISTS in the LedgerAccount table (and is not
//       soft-deleted). The account's `accountClass` is looked up server-side
//       and stored denormalized on the line.
//     - month is 1-12.
//     - amount is non-negative (uses validateBudgetAmount).
//     - optional departmentId + projectId must exist if provided.
//     - the unique constraint [budgetId, ledgerAccountCode, departmentId,
//       projectId, month] must not be violated (a duplicate returns 400).
//
//   Recomputes the parent budget's totalAmount (Σ BudgetLine.amount).
//   Requires `budgets:edit`.
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
  validateBudgetAmount,
  validateMonth,
} from "@/lib/budget-utils";

const CreateLineSchema = z.object({
  ledgerAccountCode: z.string().min(1, "Ledger account code is required").max(50),
  departmentId: z.string().optional(),
  projectId: z.string().optional(),
  month: z.number().int().min(1).max(12),
  amount: z.union([z.string(), z.number()]),
  notes: z.string().max(2000).optional(),
});

const VALID_CLASSES = new Set(["income", "expense"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("budgets", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const budget = await db.budget.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, budgetNumber: true, status: true },
  });
  if (!budget) return notFound("Budget not found.");

  if (!BUDGET_EDITABLE.has(budget.status)) {
    if (BUDGET_TERMINAL.has(budget.status)) {
      return badRequest(`Cannot add lines to a ${budget.status} budget.`);
    }
    return badRequest(
      `Cannot add lines to a ${budget.status} budget. Only draft budgets accept new lines.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateLineSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(
      parsed.error.issues[0]?.message ?? "Validation failed",
      parsed.error.issues,
    );
  }
  const d = parsed.data;

  // --- Validate month ---
  try {
    validateMonth(d.month);
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Invalid month.");
  }

  // --- Validate amount ---
  let amountStr: string;
  try {
    amountStr = validateBudgetAmount(d.amount);
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Invalid amount.");
  }

  // --- Validate ledger account exists + is income/expense ---
  const ledgerAccount = await db.ledgerAccount.findFirst({
    where: { code: d.ledgerAccountCode.trim(), deletedAt: null },
    select: { id: true, code: true, name: true, accountClass: true, status: true },
  });
  if (!ledgerAccount) {
    return badRequest(
      `Ledger account "${d.ledgerAccountCode}" does not exist. Please select a valid income or expense account.`,
    );
  }
  if (!VALID_CLASSES.has(ledgerAccount.accountClass)) {
    return badRequest(
      `Ledger account "${d.ledgerAccountCode}" has accountClass "${ledgerAccount.accountClass}". Only income/expense accounts may be budgeted.`,
    );
  }
  if (ledgerAccount.status !== "active") {
    return badRequest(
      `Ledger account "${d.ledgerAccountCode}" is ${ledgerAccount.status}. Only active accounts may be budgeted.`,
    );
  }

  // --- Validate optional departmentId ---
  if (d.departmentId) {
    const dept = await db.department.findFirst({
      where: { id: d.departmentId, ...notDeleted() },
      select: { id: true, name: true },
    });
    if (!dept) return badRequest("Selected department does not exist.");
  }

  // --- Validate optional projectId ---
  if (d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true, projectNumber: true, name: true },
    });
    if (!project) return badRequest("Selected project does not exist.");
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const line = await tx.budgetLine.create({
        data: {
          budgetId: id,
          ledgerAccountCode: ledgerAccount.code,
          accountClass: ledgerAccount.accountClass,
          departmentId: d.departmentId || null,
          projectId: d.projectId || null,
          month: d.month,
          amount: amountStr,
          notes: d.notes?.trim() || null,
        },
        include: {
          department: { select: { id: true, name: true, code: true } },
          project: { select: { id: true, projectNumber: true, name: true } },
        },
      });

      // Recompute parent budget totalAmount (server-authoritative).
      const totalStr = await recomputeBudgetTotal(tx, id);
      await tx.budget.update({
        where: { id },
        data: { totalAmount: totalStr, updatedById: auth.ctx.userId },
      });

      return { line, totalStr };
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "budgets",
      recordId: result.line.id,
      recordType: "BudgetLine",
      description: `Added budget line to ${budget.budgetNumber}: ${ledgerAccount.code} month ${d.month} = ${amountStr}`,
      newValue: {
        line: result.line,
        budgetTotal: result.totalStr,
      },
    });

    return ok(result, 201);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("Unique constraint")
    ) {
      return badRequest(
        `A line already exists for account ${ledgerAccount.code} with the same department/project/month combination. Edit the existing line instead.`,
      );
    }
    throw err;
  }
}
