// ============================================================================
// LBMS Phase 9 API — Procurement Analytics
// GET /api/reports/management/procurement?preset=month
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

  const [reqStatusCounts, poStatusCounts, poAgg, poBySupplier, grCount] = await Promise.all([
    db.procurementRequest.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }),
    db.purchaseOrder.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }),
    db.purchaseOrder.aggregate({
      _sum: { total: true },
      _count: true,
      where: { deletedAt: null, ...rangeWhere(range, "orderDate") },
    }),
    db.purchaseOrder.groupBy({
      by: ["supplierId"],
      where: { deletedAt: null, ...rangeWhere(range, "orderDate") },
      _sum: { total: true },
      _count: true,
      orderBy: { _sum: { total: "desc" } },
      take: 10,
    }),
    db.goodsReceipt.count({ where: { ...rangeWhere(range, "receiptDate") } }),
  ]);

  const supplierIds = poBySupplier.map(r => r.supplierId).filter(Boolean) as string[];
  const suppliers = await db.supplier.findMany({
    where: { id: { in: supplierIds } },
    select: { id: true, supplierNumber: true, tradingName: true, legalName: true },
  });
  const supplierMap = new Map(suppliers.map(s => [s.id, s]));
  const topSuppliers = poBySupplier.map(r => {
    const s = supplierMap.get(r.supplierId);
    return {
      supplierId: r.supplierId,
      supplierNumber: s?.supplierNumber ?? null,
      name: s?.tradingName || s?.legalName || "Unknown",
      poValue: serializeMoney(toMoney(r._sum.total ?? ZERO)),
      poCount: r._count,
    };
  });

  return ok({
    period: { from: range.from.toISOString(), to: range.to.toISOString(), preset: range.preset, label: range.label },
    requestStatusDistribution: reqStatusCounts.map(s => ({ status: s.status, count: s._count })),
    poStatusDistribution: poStatusCounts.map(s => ({ status: s.status, count: s._count })),
    totals: {
      poCount: poAgg._count,
      poTotalValue: serializeMoney(toMoney(poAgg._sum.total ?? ZERO)),
      goodsReceipts: grCount,
    },
    topSuppliersByPOValue: topSuppliers,
  });
}
