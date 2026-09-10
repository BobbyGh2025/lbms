// ============================================================================
// LBMS Phase 9 API — Customer Analytics
// GET /api/reports/management/customers?preset=month
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

  const [totalCustomers, activeCustomers, revRows] = await Promise.all([
    db.customer.count({ where: { deletedAt: null } }),
    db.customer.count({ where: { deletedAt: null, status: "active" } }),
    db.journal.groupBy({
      by: ["customerId"],
      where: { status: "posted", transactionType: "income", customerId: { not: null }, ...rangeWhere(range) },
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: "desc" } },
      take: 20,
    }),
  ]);

  const customerIds = revRows.map(r => r.customerId).filter(Boolean) as string[];
  const customers = await db.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, customerNumber: true, tradingName: true, legalName: true, status: true },
  });
  const customerMap = new Map(customers.map(c => [c.id, c]));

  const topCustomers = revRows.map(r => {
    const c = customerMap.get(r.customerId!);
    return {
      customerId: r.customerId,
      customerNumber: c?.customerNumber ?? null,
      name: c?.tradingName || c?.legalName || "Unknown",
      status: c?.status ?? null,
      revenue: serializeMoney(toMoney(r._sum.amount ?? ZERO)),
      transactionCount: r._count,
    };
  });

  // Customer-linked projects count
  const customersWithProjects = await db.project.groupBy({
    by: ["customerId"],
    where: { deletedAt: null, customerId: { not: null } },
    _count: true,
  });

  return ok({
    period: { from: range.from.toISOString(), to: range.to.toISOString(), preset: range.preset, label: range.label },
    totals: { totalCustomers, activeCustomers, customersWithRevenue: revRows.length },
    topCustomers,
    customersWithProjects: customersWithProjects.length,
  });
}
