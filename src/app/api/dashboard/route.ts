import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorize } from "@/lib/api-helpers";

export async function GET() {
  const auth = await authorize("dashboard", "view");
  if (!auth.ok) return auth.response;

  const [settings, totalStaff, activeStaff] = await Promise.all([
    db.companySetting.findUnique({ where: { id: "singleton" } }),
    db.employee.count({ where: { deletedAt: null } }),
    db.employee.count({
      where: {
        deletedAt: null,
        status: "active",
      },
    }),
  ]);

  const symbol = settings?.currencySymbol ?? "GH\u20B5";

  // Phase 1: finance / project / customer modules are not yet implemented,
  // so all financial KPIs and most business KPIs return zero. The dashboard
  // is designed to surface real values the moment downstream modules land.
  const financial = {
    todayIncome: 0,
    todayExpenditure: 0,
    monthlyIncome: 0,
    monthlyExpenditure: 0,
    monthlyProfit: 0,
    cashBalance: 0,
    accountsReceivable: 0,
    accountsPayable: 0,
    outstandingInvoices: 0,
    upcomingPayments: 0,
  };

  const business = {
    totalCustomers: 0,
    activeCustomers: 0,
    totalStaff,
    activeProjects: 0,
    completedProjects: 0,
    pendingProjects: 0,
    upcomingProjects: 0,
    overdueTasks: 0,
  };

  // Suppress unused var warning while keeping the field available for Phase 4.
  void activeStaff;

  const alerts: Array<{
    id: string;
    title: string;
    description: string;
    severity: "critical" | "warning" | "info";
    module: string;
  }> = [];

  return NextResponse.json({
    currencySymbol: symbol,
    financial,
    business,
    alerts,
    cashFlowSeries: [] as Array<{ label: string; income: number; expense: number }>,
  });
}
