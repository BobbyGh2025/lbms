// ============================================================================
// LBMS Phase 11 API — Supplier Bill post (ACCRUAL ACCOUNTING)
// ----------------------------------------------------------------------------
// POST /api/payables/bills/[id]/post
//   Transition: approved → posted.
//
//   ACCRUAL ACCOUNTING:
//   On post, posts a journal via the finance posting engine:
//     Dr Expense ledger (one Dr entry per distinct item.ledgerAccountCode,
//       default "EXP-OTHER" — expense recognized at bill posting time)
//     Cr Accounts Payable (LIB-AP)   — creates AP in the Finance ledger
//
//   This ensures:
//   - Expense is recognized at bill time (accrual basis, not cash basis)
//   - AP appears in the Finance ledger (reconciles with operational AP)
//   - Cash is NOT affected at bill time (only at supplier payment time)
//
//   Stores the journalId on the bill for void/reversal.
//   Double-posting prevention: journalId is set atomically; a second post
//   attempt returns 400.
//
//   Requires `payables:post`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import {
  isValidBillTransition,
  recomputeBillTotals,
  recomputeBillBalance,
} from "@/lib/ap-utils";
import {
  postJournal,
  FinanceValidationError,
  type JournalEntryInput,
} from "@/lib/finance/posting-engine";
import { toMoney, serializeMoney, ZERO } from "@/lib/finance/money";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("payables", "post");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.supplierBill.findFirst({
    where: { id, ...notDeleted() },
    include: {
      items: { select: { id: true, total: true, ledgerAccountCode: true } },
      supplier: { select: { id: true, supplierNumber: true, tradingName: true, legalName: true } },
    },
  });
  if (!existing) return notFound("Supplier bill not found.");

  const target = "posted";
  if (existing.status === target) return badRequest("Bill has already been posted.");
  if (!isValidBillTransition(existing.status, target)) {
    return badRequest(
      `Cannot post a ${existing.status} bill. Only approved bills may be posted.`,
    );
  }

  if (existing.items.length === 0) {
    return badRequest("Cannot post a bill with no line items.");
  }

  // Resolve LIB-AP ledger account (Accounts Payable — liability class)
  const apLedger = await db.ledgerAccount.findFirst({
    where: { code: "LIB-AP", deletedAt: null },
    select: { id: true, code: true, name: true },
  });
  if (!apLedger) {
    return badRequest("Accounts Payable ledger account (LIB-AP) is not configured. Please seed the chart of accounts.");
  }

  // Collect distinct expense ledger codes from items, defaulting to "EXP-OTHER"
  // and grouping their totals. This yields one Dr entry per expense category.
  const expenseGroups = new Map<string, typeof ZERO>();
  for (const item of existing.items) {
    const code = (item.ledgerAccountCode ?? "EXP-OTHER").trim() || "EXP-OTHER";
    const total = toMoney(item.total);
    expenseGroups.set(code, (expenseGroups.get(code) ?? ZERO).plus(total));
  }

  // Resolve all distinct expense ledger accounts in a single query.
  const expenseCodes = Array.from(expenseGroups.keys());
  const expenseLedgers = await db.ledgerAccount.findMany({
    where: { code: { in: expenseCodes }, deletedAt: null },
    select: { id: true, code: true, name: true },
  });
  const ledgerByCode = new Map(expenseLedgers.map((l) => [l.code, l]));

  // For any codes that don't resolve to a seeded ledger account, fall back
  // to EXP-OTHER (already in our map if it appears among item codes).
  const fallbackOther = await db.ledgerAccount.findFirst({
    where: { code: "EXP-OTHER", deletedAt: null },
    select: { id: true, code: true, name: true },
  });
  if (!fallbackOther) {
    return badRequest("Default expense ledger account (EXP-OTHER) is not configured. Please seed the chart of accounts.");
  }

  const now = new Date();

  // Step 1: Finalize totals BEFORE posting to Finance (so the journal amount is correct)
  const totals = await db.$transaction(async (tx) => {
    const t = await recomputeBillTotals(tx, id);
    const bal = await recomputeBillBalance(tx, id);
    await tx.supplierBill.update({
      where: { id },
      data: {
        subtotal: t.subtotal,
        tax: t.tax,
        total: t.total,
        amountPaid: bal?.amountPaid ?? "0",
        balanceDue: bal?.balanceDue ?? t.total,
        updatedById: auth.ctx.userId,
      },
    });
    return { ...t, balanceDue: bal?.balanceDue ?? t.total };
  });

  const billTotal = toMoney(totals.total);
  if (billTotal.lte(0)) {
    return badRequest("Cannot post a bill with zero total.");
  }

  // Build journal entries: one Dr per expense category, one Cr to LIB-AP
  const entries: JournalEntryInput[] = [];
  for (const [code, amount] of expenseGroups) {
    const ledger = ledgerByCode.get(code) ?? fallbackOther;
    entries.push({
      ledgerAccountId: ledger.id,
      debit: serializeMoney(amount),
      credit: ZERO.toString(),
      description: `Expense — ${ledger.name} (${ledger.code}) — Bill ${existing.billNumber}`,
    });
  }
  entries.push({
    ledgerAccountId: apLedger.id,
    debit: ZERO.toString(),
    credit: serializeMoney(billTotal),
    description: `Accounts Payable — Bill ${existing.billNumber}`,
  });

  try {
    // Step 2: POST TO FINANCE — Dr Expense(s) / Cr LIB-AP (accrual basis)
    // This recognizes expense at bill time + creates an AP balance in the ledger.
    const journal = await postJournal({
      transactionType: "expense",
      transactionDate: now,
      description: `Bill ${existing.billNumber} — ${existing.supplier?.tradingName || existing.supplier?.legalName || "Supplier"}`,
      notes: `Bill posting — expense accrual + AP recognition for ${existing.billNumber}`,
      partyType: "supplier",
      supplierId: existing.supplierId,
      projectId: existing.projectId ?? undefined,
      externalRef: existing.billNumber,
      createdById: auth.ctx.userId,
      entries,
    });

    // Step 3: Update bill status + store journalId (atomic, prevents double-posting)
    const updated = await db.supplierBill.update({
      where: { id },
      data: {
        status: target,
        postedAt: now,
        journalId: journal.id,
        updatedById: auth.ctx.userId,
      },
    });

    await auditFromCtx(auth.ctx, {
      action: "update",
      module: "payables",
      recordId: updated.id,
      recordType: "SupplierBill",
      description: `Posted bill ${updated.billNumber} (total ${serializeMoney(billTotal)}) — posted journal ${journal.reference} (Dr Expense / Cr LIB-AP)`,
      previousValue: { status: existing.status },
      newValue: {
        status: updated.status,
        postedAt: now,
        journalId: journal.id,
        journalReference: journal.reference,
        total: totals.total,
        expenseCodes,
      },
    });

    return ok({
      bill: updated,
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
      return badRequest("Bill may have already been posted. Please verify the bill status.");
    }
    throw err;
  }
}
