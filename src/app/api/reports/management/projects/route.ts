// ============================================================================
// LBMS Phase 9 API — Project Analytics
// GET /api/reports/management/projects?preset=month
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, ok } from "@/lib/api-helpers";
import { parseDateRange, rangeWhere } from "@/lib/report-utils";
import { serializeMoney, toMoney, ZERO } from "@/lib/finance/money";

export async function GET(req: NextRequest) {
  const auth = await authorize("reports", "view");
  if (!auth.ok) return auth.response;
  const range = parseDateRange(req.nextUrl.searchParams);

  const [statusCounts, projects, revRows, costRows] = await Promise.all([
    db.project.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }),
    db.project.findMany({
      where: { deletedAt: null },
      select: { id: true, projectNumber: true, name: true, status: true, customerId: true, estimatedRevenue: true, estimatedCost: true },
      orderBy: { createdAt: "desc" },
    }),
    db.journal.groupBy({
      by: ["projectId"],
      where: { status: "posted", transactionType: "income", projectId: { not: null }, ...rangeWhere(range) },
      _sum: { amount: true },
      _count: true,
    }),
    db.journal.groupBy({
      by: ["projectId"],
      where: { status: "posted", transactionType: "expense", projectId: { not: null }, ...rangeWhere(range) },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const revMap = new Map(revRows.map(r => [r.projectId, r]));
  const costMap = new Map(costRows.map(r => [r.projectId, r]));

  const projectAnalytics = projects.map(p => {
    const rev = toMoney(revMap.get(p.id)?._sum.amount ?? ZERO);
    const cost = toMoney(costMap.get(p.id)?._sum.amount ?? ZERO);
    const profit = rev.minus(cost);
    return {
      projectId: p.id,
      projectNumber: p.projectNumber,
      name: p.name,
      status: p.status,
      customerId: p.customerId,
      estimatedRevenue: serializeMoney(toMoney(p.estimatedRevenue)),
      estimatedCost: serializeMoney(toMoney(p.estimatedCost)),
      actualRevenue: serializeMoney(rev),
      actualCost: serializeMoney(cost),
      actualProfit: serializeMoney(profit),
      actualMargin: rev.gt(0) ? serializeMoney(profit.div(rev).times(100)) : "0",
      transactionCount: (revMap.get(p.id)?._count ?? 0) + (costMap.get(p.id)?._count ?? 0),
    };
  });

  const statusDistribution = statusCounts.map(s => ({ status: s.status, count: s._count }));

  // Top profitable + lowest profit
  const sorted = [...projectAnalytics].sort((a, b) => Number(b.actualProfit) - Number(a.actualProfit));
  const topProfitable = sorted.slice(0, 10);
  const lowestProfit = sorted.slice(-10).reverse();

  // Totals
  const totalRev = projectAnalytics.reduce((s, p) => s.plus(toMoney(p.actualRevenue)), ZERO);
  const totalCost = projectAnalytics.reduce((s, p) => s.plus(toMoney(p.actualCost)), ZERO);

  return ok({
    period: { from: range.from.toISOString(), to: range.to.toISOString(), preset: range.preset, label: range.label },
    statusDistribution,
    totals: {
      totalProjects: projectAnalytics.length,
      totalRevenue: serializeMoney(totalRev),
      totalCost: serializeMoney(totalCost),
      totalProfit: serializeMoney(totalRev.minus(totalCost)),
    },
    topProfitable,
    lowestProfit,
    allProjects: projectAnalytics,
  });
}
