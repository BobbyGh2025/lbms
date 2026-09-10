import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize } from "@/lib/api-helpers";
import { getFinanceSummary, getCashFlowSeries, listAccountBalances } from "@/lib/finance/reporting";
import { serializeMoney, toMoney, ZERO } from "@/lib/finance/money";

export async function GET() {
  const auth = await authorize("dashboard", "view");
  if (!auth.ok) return auth.response;

  // Date ranges for dashboard KPIs.
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [settings, totalStaff, activeStaff, todaySummary, monthSummary, balances, cashFlow,
    onLeaveStaff, probationStaff, departmentCount, openLeaveRequests,
    activeCustomers, activeSuppliers, openFollowUps,
    totalProjects, activeProjects, planningProjects, onHoldProjects, completedProjects,
    projectedRevenue, projectedCost,
    totalTasks, openTasks, inProgressTasks, onHoldTasks, completedTasks, overdueTasks, dueTodayTasks,
    openProcurementRequests, pendingApprovalRequests, approvedRequests,
    openPurchaseOrders, pendingDeliveryPOs, partiallyReceivedPOs, fullyReceivedPOs,
    totalInventoryItems, activeWarehouses, lowStockItems, stockMovementsToday] =
    await Promise.all([
      db.companySetting.findUnique({ where: { id: "singleton" } }),
      db.employee.count({ where: { deletedAt: null } }),
      db.employee.count({ where: { deletedAt: null, status: "active" } }),
      getFinanceSummary({ from: startOfToday, to: now }),
      getFinanceSummary({ from: startOfMonth, to: now }),
      listAccountBalances(),
      getCashFlowSeries(6),
      db.employee.count({ where: { deletedAt: null, status: "on_leave" } }),
      db.employee.count({ where: { deletedAt: null, status: "probation" } }),
      db.department.count({ where: { deletedAt: null, status: "active" } }),
      db.leaveRequest.count({ where: { status: "pending" } }),
      db.customer.count({ where: { deletedAt: null, status: "active" } }),
      db.supplier.count({ where: { deletedAt: null, status: "active" } }),
      db.activity.count({ where: { status: "open" } }),
      db.project.count({ where: { deletedAt: null } }),
      db.project.count({ where: { deletedAt: null, status: "active" } }),
      db.project.count({ where: { deletedAt: null, status: "planning" } }),
      db.project.count({ where: { deletedAt: null, status: "on_hold" } }),
      db.project.count({ where: { deletedAt: null, status: "completed" } }),
      db.project.aggregate({ where: { deletedAt: null, status: { in: ["planning", "active", "on_hold"] } }, _sum: { estimatedRevenue: true } }),
      db.project.aggregate({ where: { deletedAt: null, status: { in: ["planning", "active", "on_hold"] } }, _sum: { estimatedCost: true } }),
      db.task.count({ where: { deletedAt: null } }),
      db.task.count({ where: { deletedAt: null, status: "todo" } }),
      db.task.count({ where: { deletedAt: null, status: "in_progress" } }),
      db.task.count({ where: { deletedAt: null, status: "on_hold" } }),
      db.task.count({ where: { deletedAt: null, status: "completed" } }),
      db.task.count({ where: { deletedAt: null, status: { in: ["todo", "in_progress", "on_hold"] }, dueDate: { lt: now } } }),
      db.task.count({ where: { deletedAt: null, status: { in: ["todo", "in_progress", "on_hold"] }, dueDate: { gte: startOfToday, lt: new Date(startOfToday.getTime() + 86400000) } } }),
      // Phase 7 procurement KPIs (all database-derived)
      db.procurementRequest.count({ where: { deletedAt: null, status: { in: ["draft", "submitted", "approved"] } } }),
      db.procurementRequest.count({ where: { deletedAt: null, status: "submitted" } }),
      db.procurementRequest.count({ where: { deletedAt: null, status: "approved" } }),
      db.purchaseOrder.count({ where: { deletedAt: null, status: { in: ["draft", "pending_approval", "approved", "sent", "partially_received"] } } }),
      db.purchaseOrder.count({ where: { deletedAt: null, status: { in: ["approved", "sent"] } } }),
      db.purchaseOrder.count({ where: { deletedAt: null, status: "partially_received" } }),
      db.purchaseOrder.count({ where: { deletedAt: null, status: "received" } }),
      // Phase 8 inventory KPIs (all database-derived)
      db.inventoryItem.count({ where: { deletedAt: null } }),
      db.warehouse.count({ where: { deletedAt: null, active: true } }),
      // Low-stock items: balances where quantity <= item.reorderLevel (and item active).
      // Computed via a raw filter on stockBalances with item relation.
      db.stockBalance.count({
        where: {
          inventoryItem: { active: true, deletedAt: null },
        },
      }).then(async () => {
        // Prisma can't do a cross-column comparison (quantity <= reorderLevel) in
        // a count, so fetch the active balances + their reorder levels and filter.
        const balances = await db.stockBalance.findMany({
          where: { inventoryItem: { active: true, deletedAt: null } },
          select: { quantity: true, inventoryItem: { select: { reorderLevel: true } } },
        });
        return balances.filter((b) => Number(b.quantity) <= Number(b.inventoryItem.reorderLevel)).length;
      }),
      db.stockMovement.count({ where: { createdAt: { gte: startOfToday } } }),
    ]);

  void Prisma;
  const symbol = settings?.currencySymbol ?? "GH\u20B5";

  // Real financial KPIs (derived from posted journals).
  let totalCash = ZERO;
  for (const b of balances) totalCash = totalCash.plus(toMoney(b.balance));

  const financial = {
    todayIncome: todaySummary.totalIncome,
    todayExpenditure: todaySummary.totalExpenses,
    monthlyIncome: monthSummary.totalIncome,
    monthlyExpenditure: monthSummary.totalExpenses,
    monthlyProfit: monthSummary.netMovement,
    cashBalance: serializeMoney(totalCash),
    accountsReceivable: "0.00", // Phase 3
    accountsPayable: "0.00", // Phase 3
    outstandingInvoices: 0, // Phase 3
    upcomingPayments: 0, // Phase 3
  };

  const business = {
    totalCustomers: activeCustomers,
    activeCustomers,
    activeSuppliers,
    openFollowUps,
    totalStaff,
    activeStaff,
    onLeaveStaff,
    probationStaff,
    departmentCount,
    openLeaveRequests,
    totalProjects,
    activeProjects,
    planningProjects,
    onHoldProjects,
    completedProjects,
    projectedRevenue: serializeMoney(toMoney(projectedRevenue._sum.estimatedRevenue ?? 0)),
    projectedCost: serializeMoney(toMoney(projectedCost._sum.estimatedCost ?? 0)),
    projectedProfit: serializeMoney(toMoney(projectedRevenue._sum.estimatedRevenue ?? 0).minus(toMoney(projectedCost._sum.estimatedCost ?? 0))),
    totalTasks,
    openTasks,
    inProgressTasks,
    overdueTasks,
    dueTodayTasks,
    // Phase 7 procurement KPIs (all database-derived; no financial figures)
    openProcurementRequests,
    pendingApprovalRequests,
    approvedProcurementRequests: approvedRequests,
    openPurchaseOrders,
    pendingDeliveryPOs,
    partiallyReceivedPOs,
    fullyReceivedPOs,
    // Phase 8 inventory KPIs (all database-derived)
    totalInventoryItems,
    activeWarehouses,
    lowStockItems,
    stockMovementsToday,
  };

  // Alerts: surface negative cash balances (overdraft) + zero-cash accounts.
  const alerts: Array<{
    id: string;
    title: string;
    description: string;
    severity: "critical" | "warning" | "info";
    module: string;
  }> = [];
  for (const b of balances) {
    const balanceNum = Number(b.balance);
    if (balanceNum < 0) {
      alerts.push({
        id: `neg-${b.accountId}`,
        title: `Negative balance: ${b.name}`,
        description: `Account ${b.code} (${b.name}) has a negative balance of ${symbol}${Math.abs(balanceNum).toLocaleString()}.`,
        severity: "critical",
        module: "finance",
      });
    }
  }
  // Alert: net negative movement this month.
  const monthNet = Number(monthSummary.netMovement);
  if (monthNet < 0) {
    alerts.push({
      id: "month-net-neg",
      title: "Monthly expenses exceed income",
      description: `Net movement this month is negative: ${symbol}${Math.abs(monthNet).toLocaleString()}.`,
      severity: "warning",
      module: "finance",
    });
  }

  // Alert: pending leave requests for MD attention
  if (openLeaveRequests > 0) {
    alerts.push({
      id: "leave-pending",
      title: "Pending leave requests",
      description: `${openLeaveRequests} leave request${openLeaveRequests === 1 ? "" : "s"} awaiting approval.`,
      severity: "info",
      module: "leave",
    });
  }

  // Alert: procurement requests awaiting approval (Phase 7)
  if (pendingApprovalRequests > 0) {
    alerts.push({
      id: "procurement-pending",
      title: "Procurement requests pending approval",
      description: `${pendingApprovalRequests} procurement request${pendingApprovalRequests === 1 ? "" : "s"} awaiting approval.`,
      severity: "info",
      module: "procurement",
    });
  }

  // Alert: low-stock inventory items (Phase 8)
  if (lowStockItems > 0) {
    alerts.push({
      id: "inventory-low-stock",
      title: "Low-stock inventory items",
      description: `${lowStockItems} inventory item${lowStockItems === 1 ? "" : "s"} at or below reorder level.`,
      severity: "warning",
      module: "inventory",
    });
  }

  return NextResponse.json({
    currencySymbol: symbol,
    financial,
    business,
    alerts,
    cashFlowSeries: cashFlow.map((p) => ({
      label: p.label,
      income: Number(p.income),
      expense: Number(p.expense),
    })),
  });
}
