// ============================================================================
// LBMS Finance — Reporting & Balance Service
// ----------------------------------------------------------------------------
// THE single source of truth for financial balances and summaries.
// The dashboard, finance overview, reports, and exports ALL consume these
// functions. No separate calculation logic exists anywhere else (spec §42).
//
// Balance formula (spec §43):
//   For an asset account (debit-normal):
//     balance = openingPosition + Σ(posted debits) − Σ(posted credits)
//   For a liability/equity/income account (credit-normal):
//     balance = openingPosition + Σ(posted credits) − Σ(posted debits)
//
// Only POSTED journal entries affect balances. DRAFT entries are ignored.
// REVERSED originals are excluded; their reversal entries ARE included
// (the reversal mirrors the original, netting it to zero — which is the
// correct accounting outcome).
// ============================================================================

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { serializeMoney, toMoney, roundMoney, ZERO, type Money } from "./money";
import { TRANSACTION_TYPES } from "./constants";

// ---------------------------------------------------------------------------
// Date range helpers
// ---------------------------------------------------------------------------

export interface DateRange {
  from?: Date;
  to?: Date;
}

function rangeWhere(range?: DateRange) {
  if (!range?.from && !range?.to) return {};
  return {
    transactionDate: {
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lte: range.to } : {}),
    },
  };
}

/** Journals that affect balances: "posted" and "reversed" (a reversed journal's
 * entries stay; its reversal mirrors them, netting to zero — the correct
 * accounting outcome). DRAFT entries are excluded (not yet posted). VOIDED
 * entries are excluded (nullified as if they never happened). */
const POSTED_WHERE = { status: { in: ["posted", "reversed"] } };

// ---------------------------------------------------------------------------
// Account balance
// ---------------------------------------------------------------------------

export interface AccountBalance {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  currency: string;
  openingBalance: string;
  postedDebits: string;
  postedCredits: string;
  balance: string; // derived: opening + debits − credits (for asset accounts)
  transactionCount: number;
}

/**
 * Calculate the current balance of a single financial account, derived from
 * posted journal entries. This is the authoritative balance — there is no
 * mutable `currentBalance` field.
 */
export async function getAccountBalance(accountId: string): Promise<AccountBalance | null> {
  const account = await db.financialAccount.findUnique({
    where: { id: accountId, deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      accountType: true,
      currency: true,
      openingBalance: true,
    },
  });
  if (!account) return null;

  const entries = await db.journalEntry.findMany({
    where: {
      financialAccountId: accountId,
      journal: POSTED_WHERE,
    },
    select: { debit: true, credit: true },
  });

  let debits = ZERO;
  let credits = ZERO;
  for (const e of entries) {
    debits = debits.plus(toMoney(e.debit));
    credits = credits.plus(toMoney(e.credit));
  }
  debits = roundMoney(debits);
  credits = roundMoney(credits);

  // The opening balance is posted as an OPENING_BALANCE journal entry, so it
  // is already included in the debits/credits above. We do NOT add
  // `account.openingBalance` again — that would double-count. The
  // `openingBalance` field is metadata (the seed value used to generate the
  // opening journal).
  const opening = toMoney(account.openingBalance);
  // Asset accounts are debit-normal: balance = debits - credits.
  const balance = debits.minus(credits);

  return {
    accountId: account.id,
    code: account.code,
    name: account.name,
    accountType: account.accountType,
    currency: account.currency,
    openingBalance: serializeMoney(opening),
    postedDebits: serializeMoney(debits),
    postedCredits: serializeMoney(credits),
    balance: serializeMoney(balance),
    transactionCount: entries.length,
  };
}

/**
 * List all active financial accounts with their derived balances.
 */
export async function listAccountBalances(): Promise<AccountBalance[]> {
  const accounts = await db.financialAccount.findMany({
    where: { deletedAt: null },
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      accountType: true,
      currency: true,
      openingBalance: true,
    },
  });

  // Aggregate debits/credits per account in one query (avoids N+1).
  const aggregates = await db.journalEntry.groupBy({
    by: ["financialAccountId"],
    where: { journal: POSTED_WHERE },
    _sum: { debit: true, credit: true },
    _count: true,
  });
  const aggMap = new Map(aggregates.map((a) => [a.financialAccountId, a]));

  return accounts.map((account) => {
    const agg = aggMap.get(account.id);
    const debits = roundMoney(agg?._sum.debit ?? 0);
    const credits = roundMoney(agg?._sum.credit ?? 0);
    // Opening balance is posted as a journal — do NOT add it again.
    const opening = toMoney(account.openingBalance);
    // Asset accounts are debit-normal: balance = debits - credits.
    const balance = debits.minus(credits);
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      accountType: account.accountType,
      currency: account.currency,
      openingBalance: serializeMoney(opening),
      postedDebits: serializeMoney(debits),
      postedCredits: serializeMoney(credits),
      balance: serializeMoney(balance),
      transactionCount: agg?._count ?? 0,
    };
  });
}

/** Total cash position across all accounts (derived). */
export async function getTotalCashPosition(): Promise<string> {
  const balances = await listAccountBalances();
  let total = ZERO;
  for (const b of balances) total = total.plus(toMoney(b.balance));
  return serializeMoney(total);
}

// ---------------------------------------------------------------------------
// Income / Expense totals (single source of truth)
// ---------------------------------------------------------------------------

export interface FinanceSummary {
  totalIncome: string;
  totalExpenses: string;
  netMovement: string;
  cashPosition: string;
  incomeByType: { type: string; total: string; count: number }[];
  expenseByType: { type: string; total: string; count: number }[];
  transactionCount: number;
  period: { from?: string; to?: string };
}

/**
 * The authoritative finance summary for a date range. Used by the dashboard,
 * finance overview, and reports. All totals derive from posted/reversed
 * journal ENTRIES (not header amounts) so that reversals net out correctly.
 *
 * Income = Σ(credit - debit) for entries whose ledger account class = income.
 * Expense = Σ(debit - credit) for entries whose ledger account class = expense.
 * Transfers do not affect income/expense.
 */
export async function getFinanceSummary(range?: DateRange): Promise<FinanceSummary> {
  const journalWhere = {
    ...POSTED_WHERE,
    ...rangeWhere(range),
  };

  // Fetch all income/expense journal entries in range, with their ledger
  // account class for classification. We compute net income/expense from
  // entries so reversals (mirrored entries) net out to zero automatically.
  const entries = await db.journalEntry.findMany({
    where: {
      journal: journalWhere,
      ledgerAccount: { accountClass: { in: ["income", "expense"] } },
    },
    select: {
      debit: true,
      credit: true,
      ledgerAccountId: true,
      ledgerAccount: { select: { id: true, name: true, accountClass: true } },
    },
  });

  // Aggregate by ledger account.
  const byLedger = new Map<
    string,
    { name: string; accountClass: string; debit: Money; credit: Money; count: number }
  >();
  let totalIncome = ZERO;
  let totalExpenses = ZERO;

  for (const e of entries) {
    if (!e.ledgerAccount) continue;
    const key = e.ledgerAccountId!;
    const existing = byLedger.get(key) ?? {
      name: e.ledgerAccount.name,
      accountClass: e.ledgerAccount.accountClass,
      debit: ZERO,
      credit: ZERO,
      count: 0,
    };
    existing.debit = existing.debit.plus(toMoney(e.debit));
    existing.credit = existing.credit.plus(toMoney(e.credit));
    existing.count++;
    byLedger.set(key, existing);

    if (e.ledgerAccount.accountClass === "income") {
      // Income is credit-normal: net income = credits - debits
      totalIncome = totalIncome.plus(toMoney(e.credit)).minus(toMoney(e.debit));
    } else if (e.ledgerAccount.accountClass === "expense") {
      // Expense is debit-normal: net expense = debits - credits
      totalExpenses = totalExpenses.plus(toMoney(e.debit)).minus(toMoney(e.credit));
    }
  }
  totalIncome = roundMoney(totalIncome);
  totalExpenses = roundMoney(totalExpenses);

  const incomeByType = Array.from(byLedger.values())
    .filter((v) => v.accountClass === "income")
    .map((v) => ({
      type: v.name,
      total: serializeMoney(roundMoney(v.credit.minus(v.debit))),
      count: v.count,
    }))
    .sort((a, b) => Number(b.total) - Number(a.total));

  const expenseByType = Array.from(byLedger.values())
    .filter((v) => v.accountClass === "expense")
    .map((v) => ({
      type: v.name,
      total: serializeMoney(roundMoney(v.debit.minus(v.credit))),
      count: v.count,
    }))
    .sort((a, b) => Number(b.total) - Number(a.total));

  const [cashPosition, txCount] = await Promise.all([
    getTotalCashPosition(),
    db.journal.count({ where: journalWhere }),
  ]);

  const netMovement = serializeMoney(totalIncome.minus(totalExpenses));

  return {
    totalIncome: serializeMoney(totalIncome),
    totalExpenses: serializeMoney(totalExpenses),
    netMovement,
    cashPosition,
    incomeByType,
    expenseByType,
    transactionCount: txCount,
    period: {
      from: range?.from?.toISOString(),
      to: range?.to?.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Cash flow series (for charts)
// ---------------------------------------------------------------------------

export interface CashFlowPoint {
  label: string;
  income: string;
  expense: string;
  month: string; // YYYY-MM
}

/** Monthly income vs expense for the last N months (default 6).
 * Derived from ledger entries (net of reversals) so the chart matches the
 * summary totals exactly. */
export async function getCashFlowSeries(months = 6): Promise<CashFlowPoint[]> {
  const now = new Date();
  const points: CashFlowPoint[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-US", { month: "short", year: "2-digit" });
    points.push({ label, month, income: "0", expense: "0" });
  }

  const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  // Fetch income/expense entries (net of reversals) in range.
  const entries = await db.journalEntry.findMany({
    where: {
      journal: {
        ...POSTED_WHERE,
        transactionDate: { gte: from },
      },
      ledgerAccount: { accountClass: { in: ["income", "expense"] } },
    },
    select: {
      debit: true,
      credit: true,
      ledgerAccount: { select: { accountClass: true } },
      journal: { select: { transactionDate: true } },
    },
  });

  const monthMap = new Map(points.map((p) => [p.month, p]));
  for (const e of entries) {
    const td = e.journal.transactionDate;
    const m = `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, "0")}`;
    const p = monthMap.get(m);
    if (!p || !e.ledgerAccount) continue;
    if (e.ledgerAccount.accountClass === "income") {
      p.income = serializeMoney(toMoney(p.income).plus(toMoney(e.credit)).minus(toMoney(e.debit)));
    } else if (e.ledgerAccount.accountClass === "expense") {
      p.expense = serializeMoney(toMoney(p.expense).plus(toMoney(e.debit)).minus(toMoney(e.credit)));
    }
  }

  return points;
}

// ---------------------------------------------------------------------------
// Transaction listing (paginated, filtered)
// ---------------------------------------------------------------------------

export interface TransactionListItem {
  id: string;
  reference: string;
  transactionType: string;
  status: string;
  transactionDate: string;
  amount: string;
  currency: string;
  description: string | null;
  financialAccountName: string | null;
  ledgerAccountName: string | null;
  departmentName: string | null;
  paymentMethod: string | null;
  createdByName: string | null;
  reversesRef: string | null;
}

export interface TransactionListResult {
  items: TransactionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TransactionFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  transactionType?: string;
  status?: string;
  financialAccountId?: string;
  ledgerAccountId?: string;
  departmentId?: string;
  from?: Date;
  to?: Date;
}

export async function listTransactions(filters: TransactionFilters): Promise<TransactionListResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.JournalWhereInput = {};
  if (filters.search) {
    where.OR = [
      { reference: { contains: filters.search } },
      { description: { contains: filters.search } },
      { externalRef: { contains: filters.search } },
    ];
  }
  if (filters.transactionType && filters.transactionType !== "all") {
    where.transactionType = filters.transactionType;
  }
  if (filters.status && filters.status !== "all") {
    where.status = filters.status;
  }
  if (filters.financialAccountId && filters.financialAccountId !== "all") {
    where.financialAccountId = filters.financialAccountId;
  }
  if (filters.ledgerAccountId && filters.ledgerAccountId !== "all") {
    where.ledgerAccountId = filters.ledgerAccountId;
  }
  if (filters.departmentId && filters.departmentId !== "all") {
    where.departmentId = filters.departmentId;
  }
  if (filters.from || filters.to) {
    where.transactionDate = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    db.journal.findMany({
      where,
      orderBy: { transactionDate: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        reference: true,
        transactionType: true,
        status: true,
        transactionDate: true,
        amount: true,
        currency: true,
        description: true,
        paymentMethod: true,
        financialAccount: { select: { name: true } },
        ledgerAccount: { select: { name: true } },
        department: { select: { name: true } },
        createdBy: { select: { username: true } },
        reverses: { select: { reference: true } },
      },
    }),
    db.journal.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      transactionType: r.transactionType,
      status: r.status,
      transactionDate: r.transactionDate.toISOString(),
      amount: serializeMoney(r.amount),
      currency: r.currency,
      description: r.description,
      financialAccountName: r.financialAccount?.name ?? null,
      ledgerAccountName: r.ledgerAccount?.name ?? null,
      departmentName: r.department?.name ?? null,
      paymentMethod: r.paymentMethod,
      createdByName: r.createdBy?.username ?? null,
      reversesRef: r.reverses?.reference ?? null,
    })),
    total,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// Single transaction detail (with journal entries)
// ---------------------------------------------------------------------------

export interface TransactionDetail {
  id: string;
  reference: string;
  transactionType: string;
  status: string;
  transactionDate: string;
  amount: string;
  currency: string;
  description: string | null;
  notes: string | null;
  paymentMethod: string | null;
  externalRef: string | null;
  partyType: string | null;
  partyRef: string | null;
  projectRef: string | null;
  reversalReason: string | null;
  createdAt: string;
  postedAt: string | null;
  voidedAt: string | null;
  financialAccount: { id: string; name: string; code: string } | null;
  ledgerAccount: { id: string; name: string; code: string } | null;
  department: { id: string; name: string } | null;
  createdBy: { id: string; username: string; email: string } | null;
  reverses: { id: string; reference: string } | null;
  reversedBy: { id: string; reference: string } | null;
  entries: Array<{
    id: string;
    financialAccountId: string | null;
    financialAccountCode: string | null;
    financialAccountName: string | null;
    ledgerAccountCode: string | null;
    ledgerAccountName: string | null;
    debit: string;
    credit: string;
    description: string | null;
  }>;
}

export async function getTransactionDetail(id: string): Promise<TransactionDetail | null> {
  const journal = await db.journal.findUnique({
    where: { id },
    include: {
      financialAccount: { select: { id: true, name: true, code: true } },
      ledgerAccount: { select: { id: true, name: true, code: true } },
      department: { select: { id: true, name: true } },
      createdBy: { select: { id: true, username: true, email: true } },
      reverses: { select: { id: true, reference: true } },
      reversedBy: { select: { id: true, reference: true } },
      entries: {
        include: {
          financialAccount: { select: { code: true, name: true } },
          ledgerAccount: { select: { code: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!journal) return null;

  return {
    id: journal.id,
    reference: journal.reference,
    transactionType: journal.transactionType,
    status: journal.status,
    transactionDate: journal.transactionDate.toISOString(),
    amount: serializeMoney(journal.amount),
    currency: journal.currency,
    description: journal.description,
    notes: journal.notes,
    paymentMethod: journal.paymentMethod,
    externalRef: journal.externalRef,
    partyType: journal.partyType,
    partyRef: journal.partyRef,
    projectRef: journal.projectRef,
    reversalReason: journal.reversalReason,
    createdAt: journal.createdAt.toISOString(),
    postedAt: journal.postedAt?.toISOString() ?? null,
    voidedAt: journal.voidedAt?.toISOString() ?? null,
    financialAccount: journal.financialAccount
      ? { id: journal.financialAccount.id, name: journal.financialAccount.name, code: journal.financialAccount.code }
      : null,
    ledgerAccount: journal.ledgerAccount
      ? { id: journal.ledgerAccount.id, name: journal.ledgerAccount.name, code: journal.ledgerAccount.code }
      : null,
    department: journal.department ? { id: journal.department.id, name: journal.department.name } : null,
    createdBy: journal.createdBy
      ? { id: journal.createdBy.id, username: journal.createdBy.username, email: journal.createdBy.email }
      : null,
    reverses: journal.reverses ? { id: journal.reverses.id, reference: journal.reverses.reference } : null,
    reversedBy: journal.reversedBy ? { id: journal.reversedBy.id, reference: journal.reversedBy.reference } : null,
    entries: journal.entries.map((e) => ({
      id: e.id,
      financialAccountId: e.financialAccountId ?? null,
      financialAccountCode: e.financialAccount?.code ?? null,
      financialAccountName: e.financialAccount?.name ?? null,
      ledgerAccountCode: e.ledgerAccount?.code ?? null,
      ledgerAccountName: e.ledgerAccount?.name ?? null,
      debit: serializeMoney(e.debit),
      credit: serializeMoney(e.credit),
      description: e.description,
    })),
  };
}

// ---------------------------------------------------------------------------
// Reconciliation check (spec §70)
// ---------------------------------------------------------------------------

export interface ReconciliationReport {
  balanced: boolean;
  totalJournals: number;
  unbalancedJournals: number;
  issues: Array<{ journalId: string; reference: string; debitTotal: string; creditTotal: string }>;
}

/**
 * Diagnostic: scan all posted journals and verify each balances internally.
 * In a healthy system this returns zero issues. If any are found, they
 * indicate a bug in the posting engine and must be investigated.
 */
export async function runReconciliation(): Promise<ReconciliationReport> {
  const journals = await db.journal.findMany({
    where: { status: "posted" },
    select: {
      id: true,
      reference: true,
      entries: { select: { debit: true, credit: true } },
    },
  });

  const issues: ReconciliationReport["issues"] = [];
  for (const j of journals) {
    let debit = ZERO;
    let credit = ZERO;
    for (const e of j.entries) {
      debit = debit.plus(toMoney(e.debit));
      credit = credit.plus(toMoney(e.credit));
    }
    debit = roundMoney(debit);
    credit = roundMoney(credit);
    if (!debit.equals(credit)) {
      issues.push({
        journalId: j.id,
        reference: j.reference,
        debitTotal: serializeMoney(debit),
        creditTotal: serializeMoney(credit),
      });
    }
  }

  return {
    balanced: issues.length === 0,
    totalJournals: journals.length,
    unbalancedJournals: issues.length,
    issues,
  };
}

// Silence the unused-import warning for TRANSACTION_TYPES (kept for future
// validation helpers).
void TRANSACTION_TYPES;
