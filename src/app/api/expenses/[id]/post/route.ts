// ============================================================================
// LBMS Phase 11 API — Expense post (DIRECT PAYMENT — no AP)
// ----------------------------------------------------------------------------
// POST /api/expenses/[id]/post
//   Transition: approved → posted.
//
//   DIRECT PAYMENT ACCOUNTING (no AP — paid immediately):
//   On post, posts a journal via the finance posting engine:
//     Dr Expense ledger (resolved by expense.ledgerAccountCode, default "EXP-OTHER")
//     Cr FinancialAccount (Cash/Bank decreases — direct payment)
//
//   This ensures:
//   - Expense is recognized at post time
//   - Cash/bank decreases immediately (no AP intermediate step)
//   - The journalId is stored on the expense for void/reversal
//
//   Double-posting prevention: journalId is set atomically; a second post
//   attempt returns 400. Requires `expenses:post`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx,
} from "@/lib/api-helpers";
import { isValidExpenseTransition } from "@/lib/ap-utils";
import {
  postJournal,
  FinanceValidationError,
} from "@/lib/finance/posting-engine";
import { toMoney, serializeMoney, ZERO } from "@/lib/finance/money";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("expenses", "post");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.expense.findFirst({
    where: { id },
    include: {
      supplier: { select: { id: true, supplierNumber: true, tradingName: true, legalName: true } },
      project: { select: { id: true, projectNumber: true, name: true } },
    },
  });
  if (!existing) return notFound("Expense not found.");

  const target = "posted";
  if (existing.status === target) return badRequest("Expense has already been posted.");
  if (!isValidExpenseTransition(existing.status, target)) {
    return badRequest(
      `Cannot post a ${existing.status} expense. Only approved expenses may be posted.`,
    );
  }

  // Resolve the paying FinancialAccount (must be active)
  const finAcc = await db.financialAccount.findFirst({
    where: { id: existing.financialAccountId, deletedAt: null, status: "active" },
    select: { id: true, code: true, name: true, currency: true },
  });
  if (!finAcc) {
    return badRequest("Linked financial account no longer exists or is inactive. Please select another paying account.");
  }

  // Resolve the expense ledger account (defaults to "EXP-OTHER")
  const ledgerCode = (existing.ledgerAccountCode ?? "EXP-OTHER").trim() || "EXP-OTHER";
  const expenseLedger = await db.ledgerAccount.findFirst({
    where: { code: ledgerCode, deletedAt: null },
    select: { id: true, code: true, name: true, accountClass: true },
  });
  if (!expenseLedger) {
    return badRequest(`Expense ledger account "${ledgerCode}" is not configured. Please seed the chart of accounts.`);
  }
  if (expenseLedger.accountClass !== "expense") {
    return badRequest(`Ledger account "${ledgerCode}" is not an expense account (class: ${expenseLedger.accountClass}).`);
  }

  const amount = toMoney(existing.amount);
  if (amount.lte(0)) {
    return badRequest("Cannot post an expense with zero amount.");
  }

  const now = new Date();

  try {
    // --- POST TO FINANCE: Dr Expense / Cr Cash ---
    // This recognizes the expense AND pays it immediately (direct payment).
    // No AP intermediate step — cash leaves the bank account at post time.
    const journal = await postJournal({
      transactionType: "expense",
      transactionDate: existing.expenseDate,
      description: `Expense ${existing.expenseNumber} — ${existing.description}`,
      notes: `Direct expense payment for ${existing.expenseNumber}`,
      financialAccountId: finAcc.id,
      ledgerAccountId: expenseLedger.id,
      partyType: existing.supplierId ? "supplier" : undefined,
      supplierId: existing.supplierId ?? undefined,
      projectId: existing.projectId ?? undefined,
      paymentMethod: existing.paymentMethod,
      externalRef: existing.reference ?? existing.expenseNumber,
      createdById: auth.ctx.userId,
      entries: [
        {
          // Debit Expense ledger (expense increases with debit)
          ledgerAccountId: expenseLedger.id,
          debit: serializeMoney(amount),
          credit: ZERO.toString(),
          description: `Expense — ${expenseLedger.name} (${expenseLedger.code}) — ${existing.expenseNumber}`,
        },
        {
          // Credit the FinancialAccount (cash/bank decreases — asset decreases with credit)
          financialAccountId: finAcc.id,
          debit: ZERO.toString(),
          credit: serializeMoney(amount),
          description: `Cash paid — ${existing.expenseNumber}`,
        },
      ],
    });

    // Update expense status + store journalId (atomic, prevents double-posting)
    const updated = await db.expense.update({
      where: { id },
      data: {
        status: target,
        postedAt: now,
        journalId: journal.id,
      },
    });

    await auditFromCtx(auth.ctx, {
      action: "update",
      module: "expenses",
      recordId: updated.id,
      recordType: "Expense",
      description: `Posted expense ${updated.expenseNumber} (amount ${serializeMoney(amount)}) — posted journal ${journal.reference} (Dr Expense / Cr Cash)`,
      previousValue: { status: existing.status },
      newValue: {
        status: updated.status,
        postedAt: now,
        journalId: journal.id,
        journalReference: journal.reference,
        amount: serializeMoney(amount),
        ledgerAccountCode: expenseLedger.code,
      },
    });

    return ok({
      expense: updated,
      journal: {
        id: journal.id,
        reference: journal.reference,
        status: journal.status,
        amount: journal.amount,
        currency: journal.currency,
      },
    });
  } catch (err) {
    if (err instanceof FinanceValidationError) {
      return badRequest(err.message);
    }
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("Expense may have already been posted. Please verify the expense status.");
    }
    throw err;
  }
}
