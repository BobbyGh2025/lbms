// ============================================================================
// LBMS Phase 12 API — Budget Variance Analysis
// ----------------------------------------------------------------------------
// GET /api/budgets/[id]/variance
//   Compute budget vs actual for each ledger account in the budget.
//
//   METHODOLOGY:
//   1. Budget amounts: aggregate BudgetLine.amount grouped by ledgerAccountCode.
//   2. Actual amounts: derived from the authoritative Finance ledger via
//      getFinanceSummary() for the budget's [startDate, endDate] range.
//   3. For each ledger account with a budget line, compute:
//        variance = actual − budget
//        classification = account-aware (income: actual > budget → favorable;
//                         expense: actual > budget → unfavorable).
//
//   IMPORTANT: budgets NEVER post journals. Actuals come 100% from Finance.
//
//   Optional query params:
//     - groupBy=account (default) | line  — byAccount returns per-account
//       aggregations; byLine returns per-line entries with account-level
//       actuals as the line's actual.
//
//   Requires `budgets:view`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
  notFound,
  notDeleted,
} from "@/lib/api-helpers";
import { calculateVariance } from "@/lib/budget-utils";
import { getFinanceSummary } from "@/lib/finance/reporting";
import { toMoney, serializeMoney, ZERO, type Money } from "@/lib/finance/money";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("budgets", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const budget = await db.budget.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true,
      budgetNumber: true,
      name: true,
      fiscalYear: true,
      startDate: true,
      endDate: true,
      status: true,
      currency: true,
      totalAmount: true,
    },
  });
  if (!budget) return notFound("Budget not found.");

  // Load all lines for this budget.
  const lines = await db.budgetLine.findMany({
    where: { budgetId: id },
    orderBy: [{ ledgerAccountCode: "asc" }, { month: "asc" }],
    include: {
      department: { select: { id: true, name: true, code: true } },
      project: { select: { id: true, projectNumber: true, name: true } },
    },
  });

  // --- 1. Get actuals from the Finance ledger (authoritative) ---
  const summary = await getFinanceSummary({
    from: budget.startDate,
    to: budget.endDate,
  });

  // Build account-name → actual map. getFinanceSummary returns income/expense
  // by account NAME; we need to map back to CODE via the LedgerAccount table.
  const ledgerAccounts = await db.ledgerAccount.findMany({
    where: {
      accountClass: { in: ["income", "expense"] },
      deletedAt: null,
    },
    select: { id: true, code: true, name: true, accountClass: true },
  });
  const nameToCode = new Map<string, string>();
  const codeToAccount = new Map<
    string,
    { code: string; name: string; accountClass: string }
  >();
  for (const la of ledgerAccounts) {
    nameToCode.set(la.name, la.code);
    codeToAccount.set(la.code, {
      code: la.code,
      name: la.name,
      accountClass: la.accountClass,
    });
  }

  const actualByCode = new Map<string, Money>();
  for (const item of summary.incomeByType) {
    const code = nameToCode.get(item.type);
    if (code) {
      actualByCode.set(code, toMoney(item.total));
    }
  }
  for (const item of summary.expenseByType) {
    const code = nameToCode.get(item.type);
    if (code) {
      actualByCode.set(code, toMoney(item.total));
    }
  }

  // --- 2. Group budget lines by ledgerAccountCode ---
  type GroupedLine = {
    ledgerAccountCode: string;
    accountName: string;
    accountClass: string;
    totalBudget: Money;
    totalActual: Money;
    variance: ReturnType<typeof calculateVariance>;
    lineCount: number;
    lines: typeof lines;
  };
  const grouped = new Map<string, GroupedLine>();
  for (const ln of lines) {
    const acc = codeToAccount.get(ln.ledgerAccountCode) ?? {
      code: ln.ledgerAccountCode,
      name: ln.ledgerAccountCode,
      accountClass: ln.accountClass,
    };
    const actual = actualByCode.get(ln.ledgerAccountCode) ?? ZERO;
    let g = grouped.get(ln.ledgerAccountCode);
    if (!g) {
      g = {
        ledgerAccountCode: ln.ledgerAccountCode,
        accountName: acc.name,
        accountClass: ln.accountClass,
        totalBudget: ZERO,
        totalActual: actual,
        variance: calculateVariance(ZERO, actual, ln.accountClass),
        lineCount: 0,
        lines: [],
      };
      grouped.set(ln.ledgerAccountCode, g);
    }
    g.totalBudget = g.totalBudget.plus(toMoney(ln.amount));
    g.totalActual = actual;
    g.lineCount += 1;
    g.lines.push(ln);
  }

  // Recompute variance per account with the correct totals.
  const byAccount = Array.from(grouped.values()).map((g) => {
    const variance = calculateVariance(g.totalBudget, g.totalActual, g.accountClass);
    return {
      ledgerAccountCode: g.ledgerAccountCode,
      accountName: g.accountName,
      accountClass: g.accountClass,
      totalBudget: serializeMoney(g.totalBudget),
      totalActual: serializeMoney(g.totalActual),
      variance: variance.variance,
      variancePct: variance.variancePct,
      classification: variance.classification,
      lineCount: g.lineCount,
      lines: g.lines.map((ln) => ({
        id: ln.id,
        month: ln.month,
        amount: serializeMoney(ln.amount),
        department: ln.department
          ? { id: ln.department.id, name: ln.department.name, code: ln.department.code }
          : null,
        project: ln.project
          ? {
              id: ln.project.id,
              projectNumber: ln.project.projectNumber,
              name: ln.project.name,
            }
          : null,
        notes: ln.notes,
      })),
    };
  });

  // --- 3. Optional per-line breakdown (groupBy=line) ---
  const sp = req.nextUrl.searchParams;
  const groupBy = sp.get("groupBy")?.trim() || "account";

  const byLine = lines.map((ln) => {
    const actual = actualByCode.get(ln.ledgerAccountCode) ?? ZERO;
    // For per-line, the "actual" is the account-level actual (the same value
    // for every line of the same account). Variance is computed against the
    // line's budget amount.
    const variance = calculateVariance(toMoney(ln.amount), actual, ln.accountClass);
    return {
      id: ln.id,
      ledgerAccountCode: ln.ledgerAccountCode,
      accountName: codeToAccount.get(ln.ledgerAccountCode)?.name ?? ln.ledgerAccountCode,
      accountClass: ln.accountClass,
      month: ln.month,
      budgetAmount: serializeMoney(ln.amount),
      actualAmount: serializeMoney(actual),
      variance: variance.variance,
      variancePct: variance.variancePct,
      classification: variance.classification,
      department: ln.department
        ? { id: ln.department.id, name: ln.department.name, code: ln.department.code }
        : null,
      project: ln.project
        ? {
            id: ln.project.id,
            projectNumber: ln.project.projectNumber,
            name: ln.project.name,
          }
        : null,
      notes: ln.notes,
    };
  });

  // --- 4. Overall totals ---
  let totalBudget = ZERO;
  let totalActual = ZERO;
  let incomeBudget = ZERO;
  let incomeActual = ZERO;
  let expenseBudget = ZERO;
  let expenseActual = ZERO;
  let favorableCount = 0;
  let unfavorableCount = 0;
  let neutralCount = 0;
  for (const a of byAccount) {
    const b = toMoney(a.totalBudget);
    const act = toMoney(a.totalActual);
    totalBudget = totalBudget.plus(b);
    totalActual = totalActual.plus(act);
    if (a.accountClass === "income") {
      incomeBudget = incomeBudget.plus(b);
      incomeActual = incomeActual.plus(act);
    } else if (a.accountClass === "expense") {
      expenseBudget = expenseBudget.plus(b);
      expenseActual = expenseActual.plus(act);
    }
    if (a.classification === "favorable") favorableCount++;
    else if (a.classification === "unfavorable") unfavorableCount++;
    else neutralCount++;
  }

  const overallVariance = totalActual.minus(totalBudget);

  return ok({
    budget: {
      id: budget.id,
      budgetNumber: budget.budgetNumber,
      name: budget.name,
      fiscalYear: budget.fiscalYear,
      startDate: budget.startDate.toISOString(),
      endDate: budget.endDate.toISOString(),
      status: budget.status,
      currency: budget.currency,
      totalAmount: serializeMoney(budget.totalAmount),
    },
    period: {
      from: budget.startDate.toISOString(),
      to: budget.endDate.toISOString(),
    },
    groupBy,
    byAccount,
    byLine,
    totals: {
      totalBudget: serializeMoney(totalBudget),
      totalActual: serializeMoney(totalActual),
      totalVariance: serializeMoney(overallVariance),
      incomeBudget: serializeMoney(incomeBudget),
      incomeActual: serializeMoney(incomeActual),
      expenseBudget: serializeMoney(expenseBudget),
      expenseActual: serializeMoney(expenseActual),
      favorableCount,
      unfavorableCount,
      neutralCount,
    },
  });
}
