// ============================================================================
// LBMS Finance — Posting Engine (the single authoritative financial poster)
// ----------------------------------------------------------------------------
// INVARIANTS enforced here (per Phase 2 spec §67):
//   1. Posted journal entries MUST balance: Σ(debit) = Σ(credit).
//   2. Draft transactions do NOT affect balances.
//   3. Voided/reversed transactions are preserved (never hard-deleted).
//   4. Money uses exact Decimal precision (never JS number).
//   5. Every posting is atomic (db.$transaction).
//   6. Reference numbers are concurrency-safe (counter row locked in-tx).
//   7. Every posting writes an audit log entry.
//
//   Posting flow (spec §12):
//     validate permissions → validate account → validate amount → validate
//     currency → validate date → validate references → construct entries →
//     verify debits = credits → database transaction → post journal →
//     write audit log → return result
// ============================================================================

import { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import {
  isTransactionType,
  REF_PREFIXES,
  type PaymentMethod,
  type TransactionType,
} from "./constants";
import {
  MoneyError,
  roundMoney,
  serializeMoney,
  toMoney,
  toPositiveMoney,
  ZERO,
  type Money,
} from "./money";

// ---------------------------------------------------------------------------
// Public types — what callers pass to the posting engine.
// ---------------------------------------------------------------------------

export interface JournalEntryInput {
  financialAccountId?: string; // optional: only cash-side entries reference a financial account
  ledgerAccountId?: string;
  debit?: string | number | Money;
  credit?: string | number | Money;
  description?: string;
}

export interface PostJournalInput {
  transactionType: TransactionType | string;
  transactionDate: Date | string;
  description?: string;
  notes?: string;
  financialAccountId?: string; // primary account (optional for multi-account)
  ledgerAccountId?: string; // primary ledger category
  departmentId?: string;
  partyType?: "customer" | "supplier";
  partyRef?: string; // future FK to Customer/Supplier
  projectRef?: string; // future FK to Project
  paymentMethod?: PaymentMethod | string;
  externalRef?: string;
  entries: JournalEntryInput[]; // MUST contain ≥2 and balance
  createdById: string;
  status?: "draft" | "posted"; // default "posted"
}

export interface PostJournalResult {
  id: string;
  reference: string;
  transactionType: string;
  status: string;
  transactionDate: string;
  amount: string; // serialized Decimal
  currency: string;
  description: string | null;
  entryCount: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class FinanceValidationError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "FinanceValidationError";
  }
}

export class FinanceBalanceError extends FinanceValidationError {
  constructor(debitTotal: Money, creditTotal: Money) {
    super(
      `Journal entries do not balance. Total debits (${serializeMoney(debitTotal)}) ` +
        `do not equal total credits (${serializeMoney(creditTotal)}).`,
    );
    this.name = "FinanceBalanceError";
  }
}

// ---------------------------------------------------------------------------
// Reference number generation (concurrency-safe)
// ---------------------------------------------------------------------------

/**
 * Generate the next human-readable reference for a transaction type.
 * MUST be called inside a `db.$transaction` so the counter row is updated
 * atomically with the journal insert — preventing duplicate references
 * under concurrent inserts.
 *
 * Format: `<PREFIX>-<YEAR>-<6-digit-sequence>` e.g. "INC-2026-000001".
 */
async function nextReference(
  tx: Prisma.TransactionClient,
  transactionType: TransactionType,
  date: Date,
): Promise<string> {
  const prefix = REF_PREFIXES[transactionType];
  const year = date.getUTCFullYear();
  // upsert the counter row, then increment — both inside this tx.
  // SQLite serializes writes so this is safe; PG/MySQL would use SELECT FOR UPDATE.
  const counter = await tx.financeRefCounter.upsert({
    where: { prefix_year: { prefix, year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix, year, nextNumber: 2 }, // first consume returns 1
  });
  const seq = counter.nextNumber - 1; // we incremented, so the value we hold is seq+1
  return `${prefix}-${year}-${String(seq).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function parseTxType(v: string): TransactionType {
  if (!isTransactionType(v)) {
    throw new FinanceValidationError(
      `Invalid transaction type: "${v}". Must be one of: income, expense, transfer, opening_balance, adjustment.`,
    );
  }
  return v;
}

function parseTxDate(v: Date | string): Date {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) {
    throw new FinanceValidationError("Invalid transaction date.");
  }
  // Reject future dates more than 1 year ahead (sanity check).
  const oneYearAhead = new Date();
  oneYearAhead.setFullYear(oneYearAhead.getFullYear() + 1);
  if (d > oneYearAhead) {
    throw new FinanceValidationError("Transaction date is too far in the future.");
  }
  return d;
}

/** Validate that every financial account referenced in entries exists + active.
 * Entries without a financialAccountId (e.g. income/expense category lines)
 * are skipped — they touch only a ledger account. */
async function validateAccounts(
  tx: Prisma.TransactionClient,
  entries: JournalEntryInput[],
): Promise<Map<string, { id: string; currency: string; status: string; name: string }>> {
  const accountIds = Array.from(
    new Set(entries.map((e) => e.financialAccountId).filter(Boolean) as string[]),
  );
  if (!accountIds.length) {
    throw new FinanceValidationError(
      "At least one journal entry must reference a financial account.",
    );
  }
  const accounts = await tx.financialAccount.findMany({
    where: { id: { in: accountIds }, deletedAt: null },
    select: { id: true, currency: true, status: true, name: true },
  });
  const map = new Map(accounts.map((a) => [a.id, a]));
  for (const id of accountIds) {
    if (!map.has(id)) {
      throw new FinanceValidationError(`Financial account not found: ${id}.`);
    }
    const a = map.get(id)!;
    if (a.status !== "active") {
      throw new FinanceValidationError(`Financial account "${a.name}" is not active.`);
    }
  }
  // Currency consistency check — all referenced accounts must share one currency.
  const currencies = new Set(accounts.map((a) => a.currency));
  if (currencies.size > 1) {
    throw new FinanceValidationError(
      `Cross-currency transactions are not supported in Phase 2. Accounts use: ${Array.from(currencies).join(", ")}.`,
    );
  }
  return map;
}

/** Validate that ledger accounts (if referenced) exist + active. */
async function validateLedgerAccounts(
  tx: Prisma.TransactionClient,
  entries: JournalEntryInput[],
): Promise<void> {
  const ledgerIds = Array.from(
    new Set(entries.map((e) => e.ledgerAccountId).filter(Boolean) as string[]),
  );
  if (!ledgerIds.length) return;
  const ledgers = await tx.ledgerAccount.findMany({
    where: { id: { in: ledgerIds }, deletedAt: null },
    select: { id: true, status: true, name: true },
  });
  const found = new Set(ledgers.map((l) => l.id));
  for (const id of ledgerIds) {
    if (!found.has(id)) {
      throw new FinanceValidationError(`Ledger account not found: ${id}.`);
    }
    const l = ledgers.find((x) => x.id === id)!;
    if (l.status !== "active") {
      throw new FinanceValidationError(`Ledger account "${l.name}" is not active.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Balance verification
// ---------------------------------------------------------------------------

interface NormalizedEntry {
  financialAccountId?: string;
  ledgerAccountId?: string;
  debit: Money;
  credit: Money;
  description?: string;
}

function normalizeEntries(entries: JournalEntryInput[]): NormalizedEntry[] {
  if (entries.length < 2) {
    throw new FinanceValidationError(
      "A journal requires at least two entries (debit and credit).",
    );
  }
  return entries.map((e, i) => {
    const debit = e.debit !== undefined ? toMoney(e.debit) : ZERO;
    const credit = e.credit !== undefined ? toMoney(e.credit) : ZERO;
    // Exactly one of debit/credit must be non-zero (the other zero).
    if (debit.isZero() && credit.isZero()) {
      throw new FinanceValidationError(
        `Entry ${i + 1}: both debit and credit are zero. Each entry must have exactly one non-zero side.`,
      );
    }
    if (!debit.isZero() && !credit.isZero()) {
      throw new FinanceValidationError(
        `Entry ${i + 1}: both debit (${serializeMoney(debit)}) and credit (${serializeMoney(credit)}) are non-zero. An entry must be one or the other.`,
      );
    }
    // Negative amounts are not allowed.
    if (debit.lt(0) || credit.lt(0)) {
      throw new FinanceValidationError(`Entry ${i + 1}: debit/credit cannot be negative.`);
    }
    return {
      financialAccountId: e.financialAccountId,
      ledgerAccountId: e.ledgerAccountId,
      debit: roundMoney(debit),
      credit: roundMoney(credit),
      description: e.description,
    };
  });
}

function verifyBalanced(normalized: NormalizedEntry[]): { totalDebit: Money; totalCredit: Money } {
  let totalDebit = ZERO;
  let totalCredit = ZERO;
  for (const e of normalized) {
    totalDebit = totalDebit.plus(e.debit);
    totalCredit = totalCredit.plus(e.credit);
  }
  totalDebit = roundMoney(totalDebit);
  totalCredit = roundMoney(totalCredit);
  if (!totalDebit.equals(totalCredit)) {
    throw new FinanceBalanceError(totalDebit, totalCredit);
  }
  if (totalDebit.isZero()) {
    throw new FinanceValidationError("Journal total amount is zero — nothing to post.");
  }
  return { totalDebit, totalCredit };
}

// ---------------------------------------------------------------------------
// The posting engine
// ---------------------------------------------------------------------------

/**
 * Post a journal. This is the ONLY function in the codebase that creates
 * financial Journal + JournalEntry rows. All income/expense/transfer APIs
 * call this. The operation is atomic: either the whole journal posts or
 * nothing does.
 */
export async function postJournal(
  input: PostJournalInput,
  client: PrismaClient = db,
): Promise<PostJournalResult> {
  const txType = parseTxType(input.transactionType);
  const txDate = parseTxDate(input.transactionDate);
  const status = input.status === "draft" ? "draft" : "posted";

  // Pre-normalize + validate entries BEFORE opening a DB transaction.
  // This catches most validation errors cheaply without holding a tx open.
  const normalized = normalizeEntries(input.entries);
  const { totalDebit } = verifyBalanced(normalized);

  // Execute atomically.
  const result = await client.$transaction(async (tx) => {
    // Validate accounts + ledger accounts inside the tx (so they're consistent).
    const accountMap = await validateAccounts(tx, normalized);
    await validateLedgerAccounts(tx, normalized);

    const currency = accountMap.values().next().value?.currency ?? "GHS";

    // Generate a concurrency-safe reference.
    const reference = await nextReference(tx, txType, txDate);

    // Create the journal + entries in one nested write.
    const journal = await tx.journal.create({
      data: {
        reference,
        transactionType: txType,
        status,
        transactionDate: txDate,
        description: input.description ?? null,
        notes: input.notes ?? null,
        financialAccountId: input.financialAccountId ?? normalized.find((e) => e.financialAccountId)?.financialAccountId ?? null,
        ledgerAccountId: input.ledgerAccountId ?? normalized.find((e) => e.ledgerAccountId)?.ledgerAccountId ?? null,
        departmentId: input.departmentId ?? null,
        partyType: input.partyType ?? null,
        partyRef: input.partyRef ?? null,
        projectRef: input.projectRef ?? null,
        paymentMethod: (input.paymentMethod as string) ?? null,
        externalRef: input.externalRef ?? null,
        amount: totalDebit,
        currency,
        createdById: input.createdById,
        postedAt: status === "posted" ? new Date() : null,
        entries: {
          create: normalized.map((e) => ({
            financialAccountId: e.financialAccountId ?? null,
            ledgerAccountId: e.ledgerAccountId ?? null,
            debit: e.debit,
            credit: e.credit,
            currency,
            description: e.description ?? null,
          })),
        },
      },
      include: { entries: { select: { id: true } } },
    });

    return journal;
  });

  // Audit (outside the tx so audit failure never rolls back the posting —
  // the posting is the source of truth; audit is best-effort per recordAudit).
  await recordAudit({
    userId: input.createdById,
    action: status === "posted" ? "create" : "create",
    module: "finance",
    recordId: result.id,
    recordType: "Journal",
    description: `Posted ${txType} journal ${result.reference} (${serializeMoney(totalDebit)} ${result.currency})`,
    newValue: {
      reference: result.reference,
      transactionType: txType,
      status,
      transactionDate: txDate.toISOString(),
      amount: serializeMoney(totalDebit),
      currency: result.currency,
      description: input.description ?? null,
      entryCount: normalized.length,
    },
  });

  return {
    id: result.id,
    reference: result.reference,
    transactionType: txType,
    status,
    transactionDate: txDate.toISOString(),
    amount: serializeMoney(totalDebit),
    currency: result.currency,
    description: input.description ?? null,
    entryCount: normalized.length,
  };
}

// ---------------------------------------------------------------------------
// Convenience builders for income / expense / transfer
// ---------------------------------------------------------------------------

/**
 * Post an INCOME transaction.
 *
 * Accounting: money comes INTO a financial account (asset increases → debit
 * the financial account) and the company earns income (income increases →
 * credit the income ledger account). The credit side references ONLY the
 * ledger account (no financial account — income categories are not cash).
 *
 *   Debit:  FinancialAccount (asset)       [the receiving account]
 *   Credit: LedgerAccount (income)        [the income category, no fin account]
 */
export async function postIncome(args: {
  date: Date | string;
  amount: string | number | Money;
  financialAccountId: string; // receiving account
  ledgerAccountId: string; // income category
  description?: string;
  notes?: string;
  departmentId?: string;
  partyType?: "customer";
  partyRef?: string;
  projectRef?: string;
  paymentMethod?: PaymentMethod | string;
  externalRef?: string;
  createdById: string;
  status?: "draft" | "posted";
}): Promise<PostJournalResult> {
  const amount = toPositiveMoney(args.amount);
  return postJournal({
    transactionType: "income",
    transactionDate: args.date,
    description: args.description,
    notes: args.notes,
    financialAccountId: args.financialAccountId,
    ledgerAccountId: args.ledgerAccountId,
    departmentId: args.departmentId,
    partyType: args.partyType,
    partyRef: args.partyRef,
    projectRef: args.projectRef,
    paymentMethod: args.paymentMethod,
    externalRef: args.externalRef,
    createdById: args.createdById,
    status: args.status,
    entries: [
      {
        // Debit side: cash received into the financial account. No income
        // ledger account — this is an asset movement, not income recognition.
        financialAccountId: args.financialAccountId,
        debit: amount,
        credit: 0,
        description: `Income received into account`,
      },
      {
        // Credit side: income category recognition — no financial account.
        ledgerAccountId: args.ledgerAccountId,
        debit: 0,
        credit: amount,
        description: `Income category credit`,
      },
    ],
  });
}

/**
 * Post an EXPENSE transaction.
 *
 * Accounting: money goes OUT of a financial account (asset decreases →
 * credit the financial account) and the company incurs an expense
 * (expense increases → debit the expense ledger account). The debit side
 * references ONLY the ledger account (no financial account).
 *
 *   Debit:  LedgerAccount (expense)        [the expense category, no fin account]
 *   Credit: FinancialAccount (asset)       [the paying account]
 */
export async function postExpense(args: {
  date: Date | string;
  amount: string | number | Money;
  financialAccountId: string; // paying account
  ledgerAccountId: string; // expense category
  description?: string;
  notes?: string;
  departmentId?: string;
  partyType?: "supplier";
  partyRef?: string;
  projectRef?: string;
  paymentMethod?: PaymentMethod | string;
  externalRef?: string;
  createdById: string;
  status?: "draft" | "posted";
}): Promise<PostJournalResult> {
  const amount = toPositiveMoney(args.amount);
  return postJournal({
    transactionType: "expense",
    transactionDate: args.date,
    description: args.description,
    notes: args.notes,
    financialAccountId: args.financialAccountId,
    ledgerAccountId: args.ledgerAccountId,
    departmentId: args.departmentId,
    partyType: args.partyType,
    partyRef: args.partyRef,
    projectRef: args.projectRef,
    paymentMethod: args.paymentMethod,
    externalRef: args.externalRef,
    createdById: args.createdById,
    status: args.status,
    entries: [
      {
        // Debit side: expense category recognition — no financial account.
        ledgerAccountId: args.ledgerAccountId,
        debit: amount,
        credit: 0,
        description: `Expense category debit`,
      },
      {
        // Credit side: cash paid from the financial account. No expense
        // ledger account — this is an asset movement, not expense recognition.
        financialAccountId: args.financialAccountId,
        debit: 0,
        credit: amount,
        description: `Paid from account`,
      },
    ],
  });
}

/**
 * Post a TRANSFER between two financial accounts.
 *
 * Accounting: money moves from one asset account to another. Both sides
 * reference a financial account (the from-account is credited, the to-account
 * is debited). Neither income nor expense is affected.
 *
 *   Debit:  FinancialAccount (toAccount)    [receives the money]
 *   Credit: FinancialAccount (fromAccount)  [sends the money]
 */
export async function postTransfer(args: {
  date: Date | string;
  amount: string | number | Money;
  fromAccountId: string; // credit (money leaves)
  toAccountId: string; // debit (money arrives)
  ledgerAccountId?: string; // asset ledger account (optional)
  description?: string;
  notes?: string;
  externalRef?: string;
  createdById: string;
  status?: "draft" | "posted";
}): Promise<PostJournalResult> {
  if (args.fromAccountId === args.toAccountId) {
    throw new FinanceValidationError("Cannot transfer to the same account.");
  }
  const amount = toPositiveMoney(args.amount);
  return postJournal({
    transactionType: "transfer",
    transactionDate: args.date,
    description: args.description ?? `Transfer between accounts`,
    notes: args.notes,
    financialAccountId: args.fromAccountId,
    ledgerAccountId: args.ledgerAccountId,
    paymentMethod: "bank_transfer",
    externalRef: args.externalRef,
    createdById: args.createdById,
    status: args.status,
    entries: [
      {
        financialAccountId: args.toAccountId,
        ledgerAccountId: args.ledgerAccountId,
        debit: amount,
        credit: 0,
        description: `Transfer received`,
      },
      {
        financialAccountId: args.fromAccountId,
        ledgerAccountId: args.ledgerAccountId,
        debit: 0,
        credit: amount,
        description: `Transfer sent`,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Reversal engine
// ---------------------------------------------------------------------------

/**
 * Reverse a posted journal. Creates a new journal with mirrored entries
 * (debits become credits and vice versa) and marks the original as
 * `reversed`. The original is preserved (never deleted) per spec §14/§32.
 *
 * Only POSTED journals can be reversed. DRAFT/VOIDED/REVERSED cannot.
 */
export async function reverseJournal(args: {
  journalId: string;
  reason: string;
  createdById: string;
  client?: PrismaClient;
}): Promise<PostJournalResult> {
  const client = args.client ?? db;
  if (!args.reason || args.reason.trim().length < 3) {
    throw new FinanceValidationError("A reversal reason (min 3 chars) is required.");
  }

  const result = await client.$transaction(async (tx) => {
    const original = await tx.journal.findUnique({
      where: { id: args.journalId },
      include: { entries: true },
    });
    if (!original) {
      throw new FinanceValidationError("Journal not found.");
    }
    if (original.status !== "posted") {
      throw new FinanceValidationError(
        `Only posted journals can be reversed (current status: ${original.status}).`,
      );
    }
    // Already reversed?
    const existingReversal = await tx.journal.findFirst({
      where: { reversesId: original.id },
      select: { id: true, reference: true },
    });
    if (existingReversal) {
      throw new FinanceValidationError(
        `Journal ${original.reference} has already been reversed by ${existingReversal.reference}.`,
      );
    }

    const txType = original.transactionType as TransactionType;
    const reversalDate = new Date();
    const reference = await nextReference(tx, txType, reversalDate);

    // Mirror the entries: swap debit↔credit.
    const mirroredEntries = original.entries.map((e) => ({
      financialAccountId: e.financialAccountId,
      ledgerAccountId: e.ledgerAccountId ?? undefined,
      debit: e.credit, // swapped
      credit: e.debit, // swapped
      description: `Reversal of ${original.reference}`,
    }));

    const reversal = await tx.journal.create({
      data: {
        reference,
        transactionType: txType,
        status: "posted",
        transactionDate: reversalDate,
        description: `REVERSAL of ${original.reference}`,
        notes: args.reason,
        financialAccountId: original.financialAccountId,
        ledgerAccountId: original.ledgerAccountId,
        departmentId: original.departmentId,
        partyType: original.partyType,
        partyRef: original.partyRef,
        projectRef: original.projectRef,
        paymentMethod: original.paymentMethod,
        amount: original.amount,
        currency: original.currency,
        createdById: args.createdById,
        postedAt: new Date(),
        reversesId: original.id,
        reversalReason: args.reason,
        entries: {
          create: mirroredEntries.map((e) => ({
            financialAccountId: e.financialAccountId,
            ledgerAccountId: e.ledgerAccountId ?? null,
            debit: e.debit,
            credit: e.credit,
            currency: original.currency,
            description: e.description,
          })),
        },
      },
      include: { entries: { select: { id: true } } },
    });

    // Mark original as reversed.
    await tx.journal.update({
      where: { id: original.id },
      data: {
        status: "reversed",
        reversedBy: { connect: { id: reversal.id } },
      },
    });

    return {
      id: reversal.id,
      reference: reversal.reference,
      transactionType: txType,
      status: "posted",
      transactionDate: reversalDate.toISOString(),
      amount: serializeMoney(original.amount),
      currency: reversal.currency,
      description: `REVERSAL of ${original.reference}`,
      entryCount: mirroredEntries.length,
    };
  });

  // Audit (outside the tx so audit failure never rolls back the reversal —
  // the reversal is the source of truth; audit is best-effort per recordAudit).
  await recordAudit({
    userId: args.createdById,
    action: "reverse",
    module: "finance",
    recordId: args.journalId,
    recordType: "Journal",
    description: `Reversed journal via reversal ${result.reference}. Reason: ${args.reason}`,
    previousValue: { reference: result.reference, status: "posted" },
    newValue: { reference: result.reference, status: "posted", reversesId: args.journalId },
  });

  return result;
}
