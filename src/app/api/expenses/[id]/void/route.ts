// ============================================================================
// LBMS Phase 11 API — Expense void (DIRECT PAYMENT — no AP)
// ----------------------------------------------------------------------------
// POST /api/expenses/[id]/void
//   Transition: posted → voided.
//
//   DIRECT PAYMENT ACCOUNTING:
//   Reverses the payment journal via the posting engine's reverseJournal():
//     Dr FinancialAccount (Cash/Bank)  — reverses the original Cr — cash goes back up
//     Cr Expense                       — reverses the original Dr — expense goes down
//
//   This ensures:
//   - Cash is reversed (no longer counted as paid out)
//   - Expense is reversed (no longer counted)
//   - The original journal is preserved (marked "reversed") — never deleted
//
//   Requires `expenses:void`. Terminal state.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx,
} from "@/lib/api-helpers";
import { isValidExpenseTransition } from "@/lib/ap-utils";
import {
  reverseJournal,
  FinanceValidationError,
} from "@/lib/finance/posting-engine";

const VoidSchema = z.object({
  reason: z.string().min(3, "A void reason (min 3 chars) is required."),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("expenses", "void");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.expense.findFirst({
    where: { id },
    select: {
      id: true, expenseNumber: true, status: true, journalId: true,
      amount: true, ledgerAccountCode: true,
    },
  });
  if (!existing) return notFound("Expense not found.");

  const target = "voided";
  if (existing.status === target) return badRequest("Expense is already voided.");
  if (!isValidExpenseTransition(existing.status, target)) {
    return badRequest(`Cannot void a ${existing.status} expense.`);
  }
  if (!existing.journalId) {
    return badRequest("Expense has no linked journal to reverse (data integrity error).");
  }

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body. A `reason` field is required."); }
  const parsed = VoidSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  const now = new Date();

  try {
    // --- REVERSE THE JOURNAL (Dr Cash / Cr Expense — mirrors the original) ---
    const reversal = await reverseJournal({
      journalId: existing.journalId,
      reason: `Expense ${existing.expenseNumber} voided: ${d.reason}`,
      createdById: auth.ctx.userId,
    });

    const updated = await db.expense.update({
      where: { id },
      data: {
        status: target,
        voidedAt: now,
        voidedById: auth.ctx.userId,
      },
    });

    await auditFromCtx(auth.ctx, {
      action: "update",
      module: "expenses",
      recordId: updated.id,
      recordType: "Expense",
      description: `Voided expense ${updated.expenseNumber} — reversed journal ${reversal.reference} (Dr Cash / Cr Expense). Reason: ${d.reason}`,
      previousValue: { status: existing.status, journalId: existing.journalId },
      newValue: {
        status: updated.status,
        voidedAt: now,
        reversalJournalId: reversal.id,
        reversalJournalRef: reversal.reference,
      },
    });

    return ok({
      expense: updated,
      reversal: {
        id: reversal.id,
        reference: reversal.reference,
        status: reversal.status,
        amount: reversal.amount,
      },
    });
  } catch (err) {
    if (err instanceof FinanceValidationError) {
      return badRequest(err.message);
    }
    throw err;
  }
}
