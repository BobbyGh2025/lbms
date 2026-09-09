// ============================================================================
// LBMS Finance — Finance Reports API
// GET /api/finance/reports/summary   — income/expense/net/cash for a date range
// GET /api/finance/reports/account   — account activity (opening, tx, closing)
// GET /api/finance/reports/category   — income/expense grouped by category
// ============================================================================

import { NextRequest } from "next/server";
import { authorize, ok, badRequest } from "@/lib/api-helpers";
import {
  getFinanceSummary,
  listAccountBalances,
} from "@/lib/finance/reporting";
import { db } from "@/lib/db";

function parseRange(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  return {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  };
}

// GET /api/finance/reports/summary
export async function GET_summary(req: NextRequest) {
  const auth = await authorize("finance", "view_reports");
  if (!auth.ok) return auth.response;
  const range = parseRange(req);
  const summary = await getFinanceSummary(range);
  return ok(summary);
}

// GET /api/finance/reports/account
export async function GET_account(req: NextRequest) {
  const auth = await authorize("finance", "view_reports");
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  const accountId = sp.get("accountId");
  if (!accountId) return badRequest("accountId query param is required.");

  const balances = await listAccountBalances();
  const account = balances.find((b) => b.accountId === accountId);
  if (!account) return badRequest("Account not found.");

  // Fetch the account's posted transactions in the date range.
  const from = sp.get("from");
  const to = sp.get("to");
  const where: any = {
    financialAccountId: accountId,
    status: "posted",
  };
  if (from || to) {
    where.transactionDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }
  const entries = await db.journalEntry.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      debit: true, credit: true, description: true,
      journal: {
        select: {
          id: true, reference: true, transactionType: true, transactionDate: true,
          description: true, status: true,
        },
      },
    },
  });

  return ok({
    account,
    transactions: entries.map((e) => ({
      reference: e.journal.reference,
      transactionType: e.journal.transactionType,
      transactionDate: e.journal.transactionDate.toISOString(),
      description: e.description ?? e.journal.description,
      debit: e.debit.toString(),
      credit: e.credit.toString(),
      status: e.journal.status,
    })),
  });
}

// GET /api/finance/reports/category
export async function GET_category(req: NextRequest) {
  const auth = await authorize("finance", "view_reports");
  if (!auth.ok) return auth.response;
  const range = parseRange(req);
  const summary = await getFinanceSummary(range);

  return ok({
    period: summary.period,
    income: summary.incomeByType,
    expenses: summary.expenseByType,
    totals: {
      totalIncome: summary.totalIncome,
      totalExpenses: summary.totalExpenses,
      netMovement: summary.netMovement,
    },
  });
}
