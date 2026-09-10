// ============================================================================
// LBMS Phase 11 API — Expense single-record
// ----------------------------------------------------------------------------
// GET   /api/expenses/[id]   fetch one expense with supplier + employee +
//   project + financial account. Requires `expenses:view`.
// PATCH /api/expenses/[id]   edit a DRAFT expense only. expenseNumber immutable.
//   Amount must be > 0. Recomputes nothing (single-amount model).
//   Requires `expenses:edit`.
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
import { EXPENSE_TERMINAL } from "@/lib/ap-utils";
import { toMoney, serializeMoney } from "@/lib/finance/money";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, "Must be a positive decimal string");

const PAYMENT_METHODS = ["cash", "bank_transfer", "mobile_money", "card", "cheque", "other"] as const;

const PROJECT_TERMINAL = new Set(["completed", "cancelled"]);

const PatchExpenseSchema = z.object({
  description: z.string().max(500).optional(),
  amount: decimalString.optional(),
  financialAccountId: z.string().optional(),
  ledgerAccountCode: z.string().max(50).optional(),
  supplierId: z.string().nullable().optional(),
  employeeId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  expenseDate: dateString.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/expenses/[id]
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("expenses", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const expense = await db.expense.findFirst({
    where: { id },
    include: {
      supplier: {
        select: {
          id: true, supplierNumber: true, tradingName: true, legalName: true,
          email: true, phone: true, status: true,
        },
      },
      employee: {
        select: { id: true, employeeNumber: true, firstName: true, lastName: true, status: true },
      },
      project: { select: { id: true, projectNumber: true, name: true, status: true } },
      createdBy: { select: { id: true, username: true } },
      approvedBy: { select: { id: true, username: true } },
    },
  });
  if (!expense) return notFound("Expense not found.");

  // Enrich with FinancialAccount info (no Prisma relation on Expense).
  const financialAccount = expense.financialAccountId
    ? await db.financialAccount.findFirst({
        where: { id: expense.financialAccountId },
        select: { id: true, code: true, name: true, currency: true, status: true },
      })
    : null;

  return ok({ ...expense, financialAccount });
}

// ---------------------------------------------------------------------------
// PATCH /api/expenses/[id]
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("expenses", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.expense.findFirst({
    where: { id },
    select: {
      id: true, expenseNumber: true, status: true, amount: true,
      ledgerAccountCode: true, financialAccountId: true, description: true,
    },
  });
  if (!existing) return notFound("Expense not found.");

  if (existing.status !== "draft") {
    if (EXPENSE_TERMINAL.has(existing.status)) {
      return badRequest(`Cannot edit a ${existing.status} expense.`);
    }
    return badRequest(
      `Cannot edit a ${existing.status} expense. Only draft expenses may be edited.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = PatchExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // --- Validate amount > 0 ---
  let amountStr: string | undefined;
  if (d.amount !== undefined) {
    const amount = toMoney(d.amount);
    if (amount.lte(0)) {
      return badRequest("Expense amount must be greater than zero.");
    }
    amountStr = serializeMoney(amount);
  }

  // --- Validate financialAccountId ---
  if (d.financialAccountId) {
    const finAcc = await db.financialAccount.findFirst({
      where: { id: d.financialAccountId, deletedAt: null, status: "active" },
      select: { id: true, code: true },
    });
    if (!finAcc) {
      return badRequest("Selected financial account does not exist or is inactive.");
    }
  }

  // --- Validate supplierId ---
  if (d.supplierId) {
    const sup = await db.supplier.findFirst({
      where: { id: d.supplierId, ...notDeleted() },
      select: { id: true, supplierNumber: true },
    });
    if (!sup) return badRequest("Selected supplier does not exist or is archived.");
  }

  // --- Validate employeeId ---
  if (d.employeeId) {
    const emp = await db.employee.findFirst({
      where: { id: d.employeeId, deletedAt: null },
      select: { id: true, employeeNumber: true },
    });
    if (!emp) return badRequest("Selected employee does not exist or is archived.");
  }

  // --- Validate projectId ---
  if (d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true, status: true },
    });
    if (!project) return badRequest("Selected project does not exist or is archived.");
    if (PROJECT_TERMINAL.has(project.status)) {
      return badRequest(`Cannot link an expense against a ${project.status} project.`);
    }
  }

  // --- Validate ledgerAccountCode ---
  if (d.ledgerAccountCode !== undefined && d.ledgerAccountCode) {
    const ledger = await db.ledgerAccount.findFirst({
      where: { code: d.ledgerAccountCode.trim(), deletedAt: null },
      select: { id: true, code: true, accountClass: true },
    });
    if (!ledger) {
      return badRequest(`Expense category "${d.ledgerAccountCode}" does not exist in the chart of accounts.`);
    }
    if (ledger.accountClass !== "expense") {
      return badRequest(`Ledger account "${d.ledgerAccountCode}" is not an expense account (class: ${ledger.accountClass}).`);
    }
  }

  const data: Record<string, unknown> = {};
  if (d.description !== undefined) data.description = d.description.trim();
  if (amountStr !== undefined) data.amount = amountStr;
  if (d.financialAccountId !== undefined) data.financialAccountId = d.financialAccountId;
  if (d.ledgerAccountCode !== undefined) data.ledgerAccountCode = d.ledgerAccountCode.trim() || "EXP-OTHER";
  if (d.supplierId !== undefined) data.supplierId = d.supplierId || null;
  if (d.employeeId !== undefined) data.employeeId = d.employeeId || null;
  if (d.projectId !== undefined) data.projectId = d.projectId || null;
  if (d.expenseDate !== undefined) data.expenseDate = new Date(d.expenseDate);
  if (d.paymentMethod !== undefined) data.paymentMethod = d.paymentMethod;
  if (d.reference !== undefined) data.reference = d.reference?.trim() || null;
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;

  const updated = await db.expense.update({
    where: { id },
    data,
    include: {
      supplier: { select: { id: true, supplierNumber: true, tradingName: true } },
    },
  });

  // Enrich with FinancialAccount info (no Prisma relation on Expense).
  const financialAccount = updated.financialAccountId
    ? await db.financialAccount.findFirst({
        where: { id: updated.financialAccountId },
        select: { id: true, code: true, name: true },
      })
    : null;

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "expenses",
    recordId: updated.id,
    recordType: "Expense",
    description: `Updated expense ${updated.expenseNumber}`,
    previousValue: existing,
    newValue: { ...updated, financialAccount },
  });

  return ok({ ...updated, financialAccount });
}
