// ============================================================================
// LBMS Phase 12 API — Forecast Summary
// ----------------------------------------------------------------------------
// GET /api/budgets/forecast
//   Consolidated forecast summary across budgets + actuals + AR/AP forecast.
//
//   Returns:
//   - budgets: summary of all budgets (grouped by fiscalYear/status) with
//     totalAmount.
//   - budgetTotals: aggregate (incomeBudget, expenseBudget, totalBudget) for
//     active (approved/locked) budgets of the current fiscal year.
//   - actuals: actual income + expense (from getFinanceSummary — Finance
//     ledger) for the current fiscal year to date.
//   - varianceSummary: aggregate variance (Σ budget vs Σ actual) for income
//     and expense, with classification.
//   - arForecast: total outstanding AR + count.
//   - apForecast: total outstanding AP + count.
//   - cashForecast: condensed cash forecast (opening + AR − AP − planned
//     expenses = projected closing) for the default 30-day horizon.
//
//   IMPORTANT: budgets NEVER post journals. Actuals come 100% from Finance.
//
//   Requires `budgets:view`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, ok } from "@/lib/api-helpers";
import { getFinanceSummary, getTotalCashPosition } from "@/lib/finance/reporting";
import { toMoney, serializeMoney, ZERO, type Money } from "@/lib/finance/money";
import { calculateVariance } from "@/lib/budget-utils";

const ACTIVE_BUDGET_STATUSES = ["approved", "locked"];

export async function GET(req: NextRequest) {
  const auth = await authorize("budgets", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const horizonDays = Math.max(
    1,
    Math.min(365, Number(sp.get("horizon") ?? "30") || 30),
  );
  const year = Number(sp.get("fiscalYear") ?? new Date().getFullYear());

  const now = new Date();
  const fyStart = new Date(year, 0, 1);
  const fyEnd = new Date(year, 11, 31, 23, 59, 59, 999);
  const horizonEnd = new Date(now.getTime() + horizonDays * 86400000);

  // --- 1. Budget summaries (grouped by status) for the requested fiscal year ---
  const budgets = await db.budget.findMany({
    where: { deletedAt: null, fiscalYear: year },
    select: {
      id: true,
      budgetNumber: true,
      name: true,
      status: true,
      fiscalYear: true,
      totalAmount: true,
      startDate: true,
      endDate: true,
      approvedAt: true,
      lockedAt: true,
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Group totals by status.
  const totalsByStatus = new Map<string, { count: number; total: Money }>();
  for (const b of budgets) {
    const t = totalsByStatus.get(b.status) ?? { count: 0, total: ZERO };
    t.count += 1;
    t.total = t.total.plus(toMoney(b.totalAmount));
    totalsByStatus.set(b.status, t);
  }

  // --- 2. Active budget totals (approved + locked) for the year ---
  const activeBudgetIds = budgets
    .filter((b) => ACTIVE_BUDGET_STATUSES.includes(b.status))
    .map((b) => b.id);

  const activeLines = await db.budgetLine.findMany({
    where: { budgetId: { in: activeBudgetIds } },
    select: { accountClass: true, amount: true },
  });
  let incomeBudget = ZERO;
  let expenseBudget = ZERO;
  for (const ln of activeLines) {
    const amt = toMoney(ln.amount);
    if (ln.accountClass === "income") incomeBudget = incomeBudget.plus(amt);
    else if (ln.accountClass === "expense") expenseBudget = expenseBudget.plus(amt);
  }

  // --- 3. Actuals from the Finance ledger (YTD within the fiscal year) ---
  const summary = await getFinanceSummary({ from: fyStart, to: fyEnd });
  const incomeActual = toMoney(summary.totalIncome);
  const expenseActual = toMoney(summary.totalExpenses);

  // --- 4. Variance summary (income/expense aggregate, account-aware) ---
  const incomeVariance = calculateVariance(incomeBudget, incomeActual, "income");
  const expenseVariance = calculateVariance(
    expenseBudget,
    expenseActual,
    "expense",
  );

  // --- 5. AR forecast (outstanding invoices) ---
  const arInvoices = await db.invoice.findMany({
    where: {
      deletedAt: null,
      status: { in: ["issued", "partially_paid"] },
      balanceDue: { gt: 0 },
      dueDate: { lte: horizonEnd },
    },
    select: { id: true, balanceDue: true, dueDate: true },
  });
  let arTotal = ZERO;
  for (const inv of arInvoices) arTotal = arTotal.plus(toMoney(inv.balanceDue));

  // --- 6. AP forecast (outstanding bills) ---
  const apBills = await db.supplierBill.findMany({
    where: {
      deletedAt: null,
      status: { in: ["posted", "partially_paid", "paid"] },
      balanceDue: { gt: 0 },
      dueDate: { lte: horizonEnd },
    },
    select: { id: true, balanceDue: true, dueDate: true },
  });
  let apTotal = ZERO;
  for (const bill of apBills) apTotal = apTotal.plus(toMoney(bill.balanceDue));

  // --- 7. Planned expenses (within horizon months, from active budgets) ---
  const monthSet = new Set<number>();
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  while (cursor <= horizonEnd) {
    monthSet.add(cursor.getMonth() + 1);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const months = Array.from(monthSet).sort((a, b) => a - b);

  const plannedLines = await db.budgetLine.findMany({
    where: {
      accountClass: "expense",
      month: { in: months },
      budget: {
        deletedAt: null,
        status: { in: ACTIVE_BUDGET_STATUSES },
        fiscalYear: now.getFullYear(),
      },
    },
    select: { amount: true },
  });
  let plannedExpenses: Money = ZERO;
  for (const ln of plannedLines) {
    plannedExpenses = plannedExpenses.plus(toMoney(ln.amount));
  }

  // --- 8. Cash forecast (condensed) ---
  const openingCashStr = await getTotalCashPosition();
  const openingCash = toMoney(openingCashStr);
  const projectedClosing = openingCash
    .plus(arTotal)
    .minus(apTotal)
    .minus(plannedExpenses);

  // --- 9. Status breakdown for the response ---
  const statusBreakdown = Array.from(totalsByStatus.entries()).map(
    ([status, t]) => ({
      status,
      count: t.count,
      total: serializeMoney(t.total),
    }),
  );

  return ok({
    generatedAt: now.toISOString(),
    fiscalYear: year,
    horizonDays,
    period: {
      from: now.toISOString(),
      to: horizonEnd.toISOString(),
    },
    budgets: budgets.map((b) => ({
      id: b.id,
      budgetNumber: b.budgetNumber,
      name: b.name,
      status: b.status,
      fiscalYear: b.fiscalYear,
      totalAmount: serializeMoney(b.totalAmount),
      lineCount: b._count.lines,
      startDate: b.startDate.toISOString(),
      endDate: b.endDate.toISOString(),
      approvedAt: b.approvedAt?.toISOString() ?? null,
      lockedAt: b.lockedAt?.toISOString() ?? null,
    })),
    statusBreakdown,
    budgetTotals: {
      incomeBudget: serializeMoney(incomeBudget),
      expenseBudget: serializeMoney(expenseBudget),
      totalBudget: serializeMoney(incomeBudget.minus(expenseBudget)),
      activeBudgetCount: activeBudgetIds.length,
      activeLineCount: activeLines.length,
    },
    actuals: {
      incomeActual: serializeMoney(incomeActual),
      expenseActual: serializeMoney(expenseActual),
      netActual: serializeMoney(incomeActual.minus(expenseActual)),
      cashPosition: summary.cashPosition,
      transactionCount: summary.transactionCount,
      period: { from: fyStart.toISOString(), to: fyEnd.toISOString() },
    },
    varianceSummary: {
      income: incomeVariance,
      expense: expenseVariance,
      netBudget: serializeMoney(incomeBudget.minus(expenseBudget)),
      netActual: serializeMoney(incomeActual.minus(expenseActual)),
      netVariance: serializeMoney(
        incomeActual.minus(expenseActual).minus(incomeBudget.minus(expenseBudget)),
      ),
    },
    arForecast: {
      total: serializeMoney(arTotal),
      count: arInvoices.length,
    },
    apForecast: {
      total: serializeMoney(apTotal),
      count: apBills.length,
    },
    cashForecast: {
      openingCash: serializeMoney(openingCash),
      expectedAR: serializeMoney(arTotal),
      expectedAP: serializeMoney(apTotal),
      plannedExpenses: serializeMoney(plannedExpenses),
      projectedClosingCash: serializeMoney(projectedClosing),
      months,
    },
  });
}
