// ============================================================================
// LBMS Phase 9 API — Supplier Analytics
// GET /api/reports/management/suppliers?preset=month
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

  const [totalSuppliers, activeSuppliers, poRows, expRows] = await Promise.all([
    db.supplier.count({ where: { deletedAt: null } }),
    db.supplier.count({ where: { deletedAt: null, status: "active" } }),
    // PO spend by supplier
    db.purchaseOrder.groupBy({
      by: ["supplierId"],
      where: { deletedAt: null, ...rangeWhere(range, "orderDate") },
      _sum: { total: true },
      _count: true,
      orderBy: { _sum: { total: "desc" } },
      take: 20,
    }),
    // Expense by supplier (from finance)
    db.journal.groupBy({
      by: ["supplierId"],
      where: { status: "posted", transactionType: "expense", supplierId: { not: null }, ...rangeWhere(range) },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const supplierIds = [...new Set([
    ...poRows.map(r => r.supplierId),
    ...expRows.map(r => r.supplierId),
  ].filter(Boolean))] as string[];
  const suppliers = await db.supplier.findMany({
    where: { id: { in: supplierIds } },
    select: { id: true, supplierNumber: true, tradingName: true, legalName: true, status: true },
  });
  const supplierMap = new Map(suppliers.map(s => [s.id, s]));
  const poMap = new Map(poRows.map(r => [r.supplierId, r]));
  const expMap = new Map(expRows.map(r => [r.supplierId, r]));

  const supplierAnalytics = supplierIds.map(sid => {
    const s = supplierMap.get(sid);
    const po = poMap.get(sid);
    const exp = expMap.get(sid);
    return {
      supplierId: sid,
      supplierNumber: s?.supplierNumber ?? null,
      name: s?.tradingName || s?.legalName || "Unknown",
      status: s?.status ?? null,
      poValue: serializeMoney(toMoney(po?._sum.total ?? ZERO)),
      poCount: po?._count ?? 0,
      expenseValue: serializeMoney(toMoney(exp?._sum.amount ?? ZERO)),
      expenseCount: exp?._count ?? 0,
    };
  }).sort((a, b) => Number(b.poValue) - Number(a.poValue));

  return ok({
    period: { from: range.from.toISOString(), to: range.to.toISOString(), preset: range.preset, label: range.label },
    totals: { totalSuppliers, activeSuppliers, suppliersWithActivity: supplierIds.length },
    supplierAnalytics,
  });
}
