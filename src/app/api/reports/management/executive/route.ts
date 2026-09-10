// ============================================================================
// LBMS Phase 9 API — Executive Management Summary
// ----------------------------------------------------------------------------
// GET /api/reports/management/executive?preset=month
//   Unified executive KPI summary across all domains. All values derive from
//   authoritative domain services (finance/reporting, project-utils, etc.).
//   Requires `reports:view`. READ-ONLY — no mutations.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, ok } from "@/lib/api-helpers";
import { getFinanceSummary, getTotalCashPosition } from "@/lib/finance/reporting";
import { parseDateRange, rangeWhere } from "@/lib/report-utils";
import { serializeMoney, toMoney, ZERO } from "@/lib/finance/money";

export async function GET(req: NextRequest) {
  const auth = await authorize("reports", "view");
  if (!auth.ok) return auth.response;

  const range = parseDateRange(req.nextUrl.searchParams);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Authoritative finance summary for the selected period
  const summary = await getFinanceSummary({ from: range.from, to: range.to });
  const cashPosition = await getTotalCashPosition();

  // Parallel domain queries — all read-only counts/aggregates
  const [
    activeProjects, completedProjects, cancelledProjects, totalProjects,
    projectedRevenue, projectedCost,
    actualProjectRevenue, actualProjectCost,
    openTasks, overdueTasks, dueTodayTasks, completedTasks,
    activeStaff, onLeaveStaff, totalEmployees, openLeaveRequests,
    activeCustomers, activeSuppliers,
    openProcurementRequests, pendingApprovalRequests,
    openPurchaseOrders, poTotalValue, approvedPOValue,
    totalInventoryItems, activeWarehouses, lowStockItems, stockMovementsInPeriod,
  ] = await Promise.all([
    db.project.count({ where: { deletedAt: null, status: "active" } }),
    db.project.count({ where: { deletedAt: null, status: "completed" } }),
    db.project.count({ where: { deletedAt: null, status: "cancelled" } }),
    db.project.count({ where: { deletedAt: null } }),
    db.project.aggregate({ where: { deletedAt: null, status: { in: ["planning", "active", "on_hold"] } }, _sum: { estimatedRevenue: true } }),
    db.project.aggregate({ where: { deletedAt: null, status: { in: ["planning", "active", "on_hold"] } }, _sum: { estimatedCost: true } }),
    // Actual project revenue/cost = sum of posted income/expense journals linked to projects in range
    db.journal.aggregate({
      _sum: { amount: true },
      where: { status: "posted", transactionType: "income", projectId: { not: null }, ...rangeWhere(range) },
    }),
    db.journal.aggregate({
      _sum: { amount: true },
      where: { status: "posted", transactionType: "expense", projectId: { not: null }, ...rangeWhere(range) },
    }),
    db.task.count({ where: { deletedAt: null, status: "todo" } }),
    db.task.count({ where: { deletedAt: null, status: { in: ["todo", "in_progress", "on_hold"] }, dueDate: { lt: now } } }),
    db.task.count({ where: { deletedAt: null, status: { in: ["todo", "in_progress", "on_hold"] }, dueDate: { gte: startOfToday, lt: new Date(startOfToday.getTime() + 86400000) } } }),
    db.task.count({ where: { deletedAt: null, status: "completed" } }),
    db.employee.count({ where: { deletedAt: null, status: "active" } }),
    db.employee.count({ where: { deletedAt: null, status: "on_leave" } }),
    db.employee.count({ where: { deletedAt: null } }),
    db.leaveRequest.count({ where: { status: "pending" } }),
    db.customer.count({ where: { deletedAt: null, status: "active" } }),
    db.supplier.count({ where: { deletedAt: null, status: "active" } }),
    db.procurementRequest.count({ where: { deletedAt: null, status: { in: ["draft", "submitted", "approved"] } } }),
    db.procurementRequest.count({ where: { deletedAt: null, status: "submitted" } }),
    db.purchaseOrder.count({ where: { deletedAt: null, status: { in: ["draft", "pending_approval", "approved", "sent", "partially_received"] } } }),
    db.purchaseOrder.aggregate({ _sum: { total: true }, where: { deletedAt: null, ...rangeWhere(range, "orderDate") } }),
    db.purchaseOrder.aggregate({ _sum: { total: true }, where: { deletedAt: null, status: { in: ["approved", "sent", "partially_received", "received", "closed"] }, ...rangeWhere(range, "orderDate") } }),
    db.inventoryItem.count({ where: { deletedAt: null } }),
    db.warehouse.count({ where: { deletedAt: null, active: true } }),
    // Low-stock: fetch active balances + filter (cross-column comparison)
    db.stockBalance.findMany({
      where: { inventoryItem: { active: true, deletedAt: null } },
      select: { quantity: true, inventoryItem: { select: { reorderLevel: true } } },
    }).then(balances => balances.filter(b => Number(b.quantity) <= Number(b.inventoryItem.reorderLevel)).length),
    db.stockMovement.count({ where: { createdAt: { gte: range.from, lte: range.to } } }),
  ]);

  const actualRevenue = toMoney(actualProjectRevenue._sum.amount ?? ZERO);
  const actualCost = toMoney(actualProjectCost._sum.amount ?? ZERO);
  const actualProfit = actualRevenue.minus(actualCost);

  return ok({
    period: { from: range.from.toISOString(), to: range.to.toISOString(), preset: range.preset, label: range.label },
    financial: {
      totalRevenue: summary.totalIncome,
      totalExpenses: summary.totalExpenses,
      netProfit: serializeMoney(toMoney(summary.totalIncome).minus(toMoney(summary.totalExpenses))),
      cashPosition,
      transactionCount: summary.transactionCount,
      // AR/AP not yet implemented in the system — explicitly deferred
      accountsReceivable: null,
      accountsPayable: null,
    },
    projects: {
      totalProjects, activeProjects, completedProjects, cancelledProjects,
      projectedRevenue: serializeMoney(toMoney(projectedRevenue._sum.estimatedRevenue ?? ZERO)),
      projectedCost: serializeMoney(toMoney(projectedCost._sum.estimatedCost ?? ZERO)),
      projectedProfit: serializeMoney(toMoney(projectedRevenue._sum.estimatedRevenue ?? ZERO).minus(toMoney(projectedCost._sum.estimatedCost ?? ZERO))),
      actualRevenue: serializeMoney(actualRevenue),
      actualCost: serializeMoney(actualCost),
      actualProfit: serializeMoney(actualProfit),
      actualMargin: actualRevenue.gt(0) ? serializeMoney(actualProfit.div(actualRevenue).times(100)) : "0",
    },
    operations: {
      openTasks, overdueTasks, dueTodayTasks, completedTasks,
    },
    workforce: {
      totalEmployees, activeStaff, onLeaveStaff, openLeaveRequests,
    },
    crm: {
      activeCustomers, activeSuppliers,
    },
    procurement: {
      openRequests: openProcurementRequests,
      pendingApprovalRequests,
      openPurchaseOrders,
      poTotalValue: serializeMoney(toMoney(poTotalValue._sum.total ?? ZERO)),
      approvedPOValue: serializeMoney(toMoney(approvedPOValue._sum.total ?? ZERO)),
    },
    inventory: {
      totalItems: totalInventoryItems,
      activeWarehouses,
      lowStockItems,
      movementsInPeriod: stockMovementsInPeriod,
    },
  });
}
