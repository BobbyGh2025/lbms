// ============================================================================
// LBMS Phase 9 API — Financial Analytics
// ----------------------------------------------------------------------------
// GET /api/reports/management/financial?preset=month
//   Revenue/expense breakdown by category, by customer, by project, plus
//   monthly trend. All derived from the authoritative finance reporting
//   service. Requires `reports:view`. READ-ONLY.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, ok } from "@/lib/api-helpers";
import { getFinanceSummary, getCashFlowSeries } from "@/lib/finance/reporting";
import { parseDateRange, rangeWhere } from "@/lib/report-utils";
import { serializeMoney, toMoney, ZERO } from "@/lib/finance/money";

export async function GET(req: NextRequest) {
  const auth = await authorize("reports", "view");
  if (!auth.ok) return auth.response;

  const range = parseDateRange(req.nextUrl.searchParams);

  // Authoritative summary (income/expense by category)
  const summary = await getFinanceSummary({ from: range.from, to: range.to });

  // Revenue by customer — posted income journals grouped by customerId
  const revenueByCustomerRows = await db.journal.groupBy({
    by: ["customerId"],
    where: {
      status: "posted",
      transactionType: "income",
      customerId: { not: null },
      ...rangeWhere(range),
    },
    _sum: { amount: true },
    _count: true,
    orderBy: { _sum: { amount: "desc" } },
    take: 10,
  });
  const customerIds = revenueByCustomerRows.map(r => r.customerId).filter(Boolean) as string[];
  const customers = await db.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, customerNumber: true, tradingName: true, legalName: true },
  });
  const customerMap = new Map(customers.map(c => [c.id, c]));
  const revenueByCustomer = revenueByCustomerRows.map(r => {
    const c = customerMap.get(r.customerId!);
    return {
      customerId: r.customerId,
      customerNumber: c?.customerNumber ?? null,
      name: c?.tradingName || c?.legalName || "Unknown",
      revenue: serializeMoney(toMoney(r._sum.amount ?? ZERO)),
      transactionCount: r._count,
    };
  });

  // Expense by supplier — posted expense journals grouped by supplierId
  const expenseBySupplierRows = await db.journal.groupBy({
    by: ["supplierId"],
    where: {
      status: "posted",
      transactionType: "expense",
      supplierId: { not: null },
      ...rangeWhere(range),
    },
    _sum: { amount: true },
    _count: true,
    orderBy: { _sum: { amount: "desc" } },
    take: 10,
  });
  const supplierIds = expenseBySupplierRows.map(r => r.supplierId).filter(Boolean) as string[];
  const suppliers = await db.supplier.findMany({
    where: { id: { in: supplierIds } },
    select: { id: true, supplierNumber: true, tradingName: true, legalName: true },
  });
  const supplierMap = new Map(suppliers.map(s => [s.id, s]));
  const expenseBySupplier = expenseBySupplierRows.map(r => {
    const s = supplierMap.get(r.supplierId!);
    return {
      supplierId: r.supplierId,
      supplierNumber: s?.supplierNumber ?? null,
      name: s?.tradingName || s?.legalName || "Unknown",
      expense: serializeMoney(toMoney(r._sum.amount ?? ZERO)),
      transactionCount: r._count,
    };
  });

  // Revenue/cost by project — posted journals grouped by projectId
  const [projRevRows, projCostRows] = await Promise.all([
    db.journal.groupBy({
      by: ["projectId"],
      where: { status: "posted", transactionType: "income", projectId: { not: null }, ...rangeWhere(range) },
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: "desc" } },
      take: 10,
    }),
    db.journal.groupBy({
      by: ["projectId"],
      where: { status: "posted", transactionType: "expense", projectId: { not: null }, ...rangeWhere(range) },
      _sum: { amount: true },
      _count: true,
    }),
  ]);
  const projectIds = [...new Set([...projRevRows.map(r => r.projectId), ...projCostRows.map(r => r.projectId)].filter(Boolean) as string[])];
  const projects = await db.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, projectNumber: true, name: true, status: true },
  });
  const projectMap = new Map(projects.map(p => [p.id, p]));
  const revByProject = new Map(projRevRows.map(r => [r.projectId, r]));
  const costByProject = new Map(projCostRows.map(r => [r.projectId, r]));
  const projectFinance = projectIds.map(pid => {
    const p = projectMap.get(pid);
    const rev = toMoney(revByProject.get(pid)?._sum.amount ?? ZERO);
    const cost = toMoney(costByProject.get(pid)?._sum.amount ?? ZERO);
    return {
      projectId: pid,
      projectNumber: p?.projectNumber ?? null,
      name: p?.name ?? "Unknown",
      status: p?.status ?? null,
      revenue: serializeMoney(rev),
      cost: serializeMoney(cost),
      profit: serializeMoney(rev.minus(cost)),
      margin: rev.gt(0) ? serializeMoney(rev.minus(cost).div(rev).times(100)) : "0",
      transactionCount: (revByProject.get(pid)?._count ?? 0) + (costByProject.get(pid)?._count ?? 0),
    };
  }).sort((a, b) => Number(b.profit) - Number(a.profit));

  // Monthly trend (income vs expense vs net) — last 12 months
  const cashFlow = await getCashFlowSeries(12);

  return ok({
    period: { from: range.from.toISOString(), to: range.to.toISOString(), preset: range.preset, label: range.label },
    summary: {
      totalRevenue: summary.totalIncome,
      totalExpenses: summary.totalExpenses,
      netProfit: serializeMoney(toMoney(summary.totalIncome).minus(toMoney(summary.totalExpenses))),
      transactionCount: summary.transactionCount,
    },
    incomeByCategory: summary.incomeByType,
    expenseByCategory: summary.expenseByType,
    revenueByCustomer,
    expenseBySupplier,
    projectFinance,
    monthlyTrend: cashFlow.map(p => ({
      label: p.label,
      month: p.month,
      income: Number(p.income),
      expense: Number(p.expense),
      net: Number(toMoney(p.income).minus(toMoney(p.expense)).toString()),
    })),
  });
}
