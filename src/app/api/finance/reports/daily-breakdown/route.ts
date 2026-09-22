// ============================================================================
// LBMS Finance API — Daily Breakdown Report
// ----------------------------------------------------------------------------
// GET /api/finance/reports/daily-breakdown?month=YYYY-MM
//   Returns per-day income, expense, and profit for the given month.
//   All figures derive from posted journal entries (draft/voided excluded).
//   Requires `finance:view`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, ok, badRequest } from "@/lib/api-helpers";
import { toMoney, serializeMoney, ZERO } from "@/lib/finance/money";

export async function GET(req: NextRequest) {
  const auth = await authorize("finance", "view");
  if (!auth.ok) return auth.response;

  const sp = new URL(req.url).searchParams;
  const monthParam = sp.get("month"); // YYYY-MM

  const now = new Date();
  const year = monthParam ? parseInt(monthParam.split("-")[0]) : now.getFullYear();
  const month = monthParam ? parseInt(monthParam.split("-")[1]) - 1 : now.getMonth();

  if (isNaN(year) || isNaN(month) || month < 0 || month > 11) {
    return badRequest("Invalid month. Use YYYY-MM format.");
  }

  const from = new Date(year, month, 1);
  const to = new Date(year, month + 1, 0, 23, 59, 59, 999);

  // Fetch all posted journal entries in the range, joined with ledger account class
  const entries = (await db.$queryRaw`
    SELECT
      DATE(j."transactionDate") AS tx_date,
      la."accountClass",
      je."debit",
      je."credit"
    FROM "JournalEntry" je
    INNER JOIN "Journal" j ON j."id" = je."journalId"
    LEFT JOIN "LedgerAccount" la ON la."id" = je."ledgerAccountId"
    WHERE j."status" IN ('posted', 'reversed')
      AND j."transactionDate" >= ${from}
      AND j."transactionDate" <= ${to}
      AND la."deletedAt" IS NULL
      AND la."accountClass" IN ('income', 'expense')
  `) as Array<{ tx_date: Date; accountClass: string; debit: string; credit: string }>;

  // Aggregate per day
  const dayMap = new Map<string, { income: typeof ZERO; expense: typeof ZERO }>();

  for (const e of entries) {
    const dateKey = new Date(e.tx_date).toISOString().slice(0, 10);
    if (!dayMap.has(dateKey)) {
      dayMap.set(dateKey, { income: ZERO, expense: ZERO });
    }
    const day = dayMap.get(dateKey)!;
    if (e.accountClass === "income") {
      // Income: credit increases revenue
      day.income = day.income.plus(toMoney(e.credit)).minus(toMoney(e.debit));
    } else if (e.accountClass === "expense") {
      // Expense: debit increases expense
      day.expense = day.expense.plus(toMoney(e.debit)).minus(toMoney(e.credit));
    }
  }

  // Build the daily array for the full month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daily: Array<{
    date: string;
    income: string;
    expense: string;
    profit: string;
  }> = [];

  let totalIncome = ZERO;
  let totalExpense = ZERO;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const day = dayMap.get(dateKey);
    const income = day?.income ?? ZERO;
    const expense = day?.expense ?? ZERO;
    const profit = income.minus(expense);
    totalIncome = totalIncome.plus(income);
    totalExpense = totalExpense.plus(expense);
    daily.push({
      date: dateKey,
      income: serializeMoney(income),
      expense: serializeMoney(expense),
      profit: serializeMoney(profit),
    });
  }

  return ok({
    month: `${year}-${String(month + 1).padStart(2, "0")}`,
    daily,
    totals: {
      income: serializeMoney(totalIncome),
      expense: serializeMoney(totalExpense),
      profit: serializeMoney(totalIncome.minus(totalExpense)),
    },
  });
}
