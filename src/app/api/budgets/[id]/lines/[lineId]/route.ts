// ============================================================================
// LBMS Phase 12 API — Budget Line single-record
// ----------------------------------------------------------------------------
// PATCH   /api/budgets/[id]/lines/[lineId]   edit a budget line. ONLY allowed
//   while the parent budget is in DRAFT. ledgerAccountCode is IMMUTABLE after
//   creation (the unique constraint includes it; changing it would be a
//   new line — delete + recreate). departmentId, projectId, month, amount
//   and notes are editable. Recomputes the parent budget's totalAmount.
// DELETE  /api/budgets/[id]/lines/[lineId]   remove a budget line. ONLY
//   allowed while the parent budget is in DRAFT. Recomputes the parent
//   budget's totalAmount.
//
// Both require `budgets:edit`.
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

const PatchLineSchema = z.object({
  departmentId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  month: z.number().int().min(1).max(12).optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// ---------------------------------------------------------------------------
// PATCH /api/budgets/[id]/lines/[lineId]
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  const auth = await authorize("budgets", "edit");
  if (!auth.ok) return auth.response;

  const { id, lineId } = await params;
  const budget = await db.budget.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, budgetNumber: true, status: true },
  });
  if (!budget) return notFound("Budget not found.");

  if (!BUDGET_EDITABLE.has(budget.status)) {
    if (BUDGET_TERMINAL.has(budget.status)) {
      return badRequest(`Cannot edit lines of a ${budget.status} budget.`);
    }
    return badRequest(
      `Cannot edit lines of a ${budget.status} budget. Only draft budgets may be edited.`,
    );
  }

  const existingLine = await db.budgetLine.findUnique({
    where: { id: lineId },
    select: {
      id: true,
      budgetId: true,
      ledgerAccountCode: true,
      accountClass: true,
      departmentId: true,
      projectId: true,
      month: true,
      amount: true,
      notes: true,
    },
  });
  if (!existingLine || existingLine.budgetId !== id) {
    return notFound("Budget line not found.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = PatchLineSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(
      parsed.error.issues[0]?.message ?? "Validation failed",
      parsed.error.issues,
    );
  }
  const d = parsed.data;

  // --- Validate month (if provided) ---
  if (d.month !== undefined) {
    try {
      validateMonth(d.month);
    } catch (e) {
      return badRequest(e instanceof Error ? e.message : "Invalid month.");
    }
  }

  // --- Validate amount (if provided) ---
  let amountStr: string | undefined;
  if (d.amount !== undefined) {
    try {
      amountStr = validateBudgetAmount(d.amount);
    } catch (e) {
      return badRequest(e instanceof Error ? e.message : "Invalid amount.");
    }
  }

  // --- Validate departmentId (if changed) ---
  if (d.departmentId !== undefined && d.departmentId) {
    const dept = await db.department.findFirst({
      where: { id: d.departmentId, ...notDeleted() },
      select: { id: true },
    });
    if (!dept) return badRequest("Selected department does not exist.");
  }

  // --- Validate projectId (if changed) ---
  if (d.projectId !== undefined && d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true },
    });
    if (!project) return badRequest("Selected project does not exist.");
  }

  // Build update payload — ledgerAccountCode is intentionally NOT editable.
  const data: Record<string, unknown> = {};
  if (d.departmentId !== undefined) data.departmentId = d.departmentId || null;
  if (d.projectId !== undefined) data.projectId = d.projectId || null;
  if (d.month !== undefined) data.month = d.month;
  if (amountStr !== undefined) data.amount = amountStr;
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;

  try {
    const result = await db.$transaction(async (tx) => {
      const updatedLine = await tx.budgetLine.update({
        where: { id: lineId },
        data,
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
      return { updatedLine, totalStr };
    });

    await auditFromCtx(auth.ctx, {
      action: "update",
      module: "budgets",
      recordId: result.updatedLine.id,
      recordType: "BudgetLine",
      description: `Updated budget line in ${budget.budgetNumber}: ${existingLine.ledgerAccountCode} month ${existingLine.month}`,
      previousValue: {
        ledgerAccountCode: existingLine.ledgerAccountCode,
        month: existingLine.month,
        amount: existingLine.amount,
        departmentId: existingLine.departmentId,
        projectId: existingLine.projectId,
        notes: existingLine.notes,
      },
      newValue: {
        ...result.updatedLine,
        budgetTotal: result.totalStr,
      },
    });

    return ok(result.updatedLine);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("Unique constraint")
    ) {
      return badRequest(
        `A line already exists for account ${existingLine.ledgerAccountCode} with the same department/project/month combination. The combination must be unique within a budget.`,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/budgets/[id]/lines/[lineId]
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  const auth = await authorize("budgets", "edit");
  if (!auth.ok) return auth.response;

  const { id, lineId } = await params;
  const budget = await db.budget.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, budgetNumber: true, status: true },
  });
  if (!budget) return notFound("Budget not found.");

  if (!BUDGET_EDITABLE.has(budget.status)) {
    if (BUDGET_TERMINAL.has(budget.status)) {
      return badRequest(`Cannot delete lines from a ${budget.status} budget.`);
    }
    return badRequest(
      `Cannot delete lines from a ${budget.status} budget. Only draft budgets may be edited.`,
    );
  }

  const existingLine = await db.budgetLine.findUnique({
    where: { id: lineId },
    select: {
      id: true,
      budgetId: true,
      ledgerAccountCode: true,
      accountClass: true,
      month: true,
      amount: true,
    },
  });
  if (!existingLine || existingLine.budgetId !== id) {
    return notFound("Budget line not found.");
  }

  const result = await db.$transaction(async (tx) => {
    await tx.budgetLine.delete({ where: { id: lineId } });
    // Recompute parent budget totalAmount (server-authoritative).
    const totalStr = await recomputeBudgetTotal(tx, id);
    await tx.budget.update({
      where: { id },
      data: { totalAmount: totalStr, updatedById: auth.ctx.userId },
    });
    return { totalStr };
  });

  await auditFromCtx(auth.ctx, {
    action: "delete",
    module: "budgets",
    recordId: lineId,
    recordType: "BudgetLine",
    description: `Deleted budget line from ${budget.budgetNumber}: ${existingLine.ledgerAccountCode} month ${existingLine.month} (was ${existingLine.amount})`,
    previousValue: existingLine,
    newValue: { budgetTotal: result.totalStr },
  });

  return ok({ deleted: true, id: lineId, budgetTotal: result.totalStr });
}
