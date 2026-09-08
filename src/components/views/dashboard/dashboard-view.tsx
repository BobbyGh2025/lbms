"use client";

import { useEffect, useState } from "react";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  DollarSign,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileText,
  Users,
  UserCheck,
  FolderKanban,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Activity,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/common/kpi-card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";

interface DashboardData {
  currencySymbol: string;
  financial: {
    todayIncome: number;
    todayExpenditure: number;
    monthlyIncome: number;
    monthlyExpenditure: number;
    monthlyProfit: number;
    cashBalance: number;
    accountsReceivable: number;
    accountsPayable: number;
    outstandingInvoices: number;
    upcomingPayments: number;
  };
  business: {
    totalCustomers: number;
    activeCustomers: number;
    totalStaff: number;
    activeProjects: number;
    completedProjects: number;
    pendingProjects: number;
    upcomingProjects: number;
    overdueTasks: number;
  };
  alerts: Array<{
    id: string;
    title: string;
    description: string;
    severity: "critical" | "warning" | "info";
    module: string;
  }>;
  cashFlowSeries: Array<{ label: string; income: number; expense: number }>;
}

const SEVERITY_STYLES: Record<string, { badge: string; icon: LucideIcon }> = {
  critical: {
    badge: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
    icon: AlertTriangle,
  },
  warning: {
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    icon: Bell,
  },
  info: {
    badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
    icon: Activity,
  },
};

function formatMoney(amount: number, symbol: string) {
  if (amount === 0) return `${symbol}0`;
  return `${symbol}${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function DashboardView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dashboard");
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const symbol = data?.currencySymbol ?? "GH₵";
  const f = data?.financial;
  const b = data?.business;

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Executive Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          A single view of Lightworld Tech&apos;s financial, operational and people health.
        </p>
      </div>

      {/* Financial KPIs */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Financial KPIs
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
          <KpiCard
            label="Today's Income"
            value={f ? formatMoney(f.todayIncome, symbol) : undefined}
            icon={TrendingUp}
            accent="success"
            loading={loading}
            hint="Income recorded today"
          />
          <KpiCard
            label="Today's Expenditure"
            value={f ? formatMoney(f.todayExpenditure, symbol) : undefined}
            icon={TrendingDown}
            accent="danger"
            loading={loading}
            hint="Expenses recorded today"
          />
          <KpiCard
            label="Monthly Income"
            value={f ? formatMoney(f.monthlyIncome, symbol) : undefined}
            icon={DollarSign}
            accent="success"
            loading={loading}
            hint="Current month to date"
          />
          <KpiCard
            label="Monthly Expenditure"
            value={f ? formatMoney(f.monthlyExpenditure, symbol) : undefined}
            icon={TrendingDown}
            accent="danger"
            loading={loading}
            hint="Current month to date"
          />
          <KpiCard
            label="Monthly Profit"
            value={f ? formatMoney(f.monthlyProfit, symbol) : undefined}
            icon={DollarSign}
            accent={f && f.monthlyProfit >= 0 ? "success" : "danger"}
            loading={loading}
            hint="Income − Expenditure"
          />
          <KpiCard
            label="Cash Balance"
            value={f ? formatMoney(f.cashBalance, symbol) : undefined}
            icon={Wallet}
            loading={loading}
            hint="All active accounts"
          />
          <KpiCard
            label="Accounts Receivable"
            value={f ? formatMoney(f.accountsReceivable, symbol) : undefined}
            icon={ArrowDownToLine}
            accent="info"
            loading={loading}
            hint="Owed by customers"
          />
          <KpiCard
            label="Accounts Payable"
            value={f ? formatMoney(f.accountsPayable, symbol) : undefined}
            icon={ArrowUpFromLine}
            accent="warning"
            loading={loading}
            hint="Owed to suppliers"
          />
          <KpiCard
            label="Outstanding Invoices"
            value={f?.outstandingInvoices ?? undefined}
            icon={FileText}
            accent="warning"
            loading={loading}
            hint="Unpaid + partially paid"
          />
          <KpiCard
            label="Upcoming Payments"
            value={f?.upcomingPayments ?? undefined}
            icon={Clock}
            accent="info"
            loading={loading}
            hint="Due within 7 days"
          />
        </div>
      </div>

      {/* Chart + Alerts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Cash Flow Overview</CardTitle>
              <CardDescription className="text-xs">
                Income vs Expenditure · last 6 months
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-[10px]">
              Phase 2+
            </Badge>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[260px] w-full">
              {loading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Loading chart…
                </div>
              ) : data?.cashFlowSeries && data.cashFlowSeries.some((d) => d.income > 0 || d.expense > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.cashFlowSeries}>
                    <defs>
                      <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="oklch(0.55 0.14 162)" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="oklch(0.55 0.14 162)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="oklch(0.65 0.2 25)" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="oklch(0.65 0.2 25)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                      tickLine={false}
                      axisLine={false}
                      width={50}
                    />
                    <ReTooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid hsl(var(--border))",
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="income"
                      stroke="oklch(0.55 0.14 162)"
                      strokeWidth={2}
                      fill="url(#incomeGrad)"
                      name="Income"
                    />
                    <Area
                      type="monotone"
                      dataKey="expense"
                      stroke="oklch(0.65 0.2 25)"
                      strokeWidth={2}
                      fill="url(#expenseGrad)"
                      name="Expenditure"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <Activity className="h-8 w-8 opacity-30" />
                  <p className="text-sm">
                    No financial data yet. Income &amp; expenditure tracking lands in Phase 2.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Alerts &amp; Attention</CardTitle>
              <CardDescription className="text-xs">Items requiring MD action</CardDescription>
            </div>
            <Badge variant="secondary" className="text-[10px]">
              {data?.alerts.length ?? 0}
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[260px]">
              {loading ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Loading alerts…
                </div>
              ) : !data?.alerts.length ? (
                <div className="flex flex-col items-center gap-2 p-8 text-center text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  <p className="text-sm">No critical alerts. All clear.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {data.alerts.map((a) => {
                    const s = SEVERITY_STYLES[a.severity] ?? SEVERITY_STYLES.info;
                    const Icon = s.icon;
                    return (
                      <div key={a.id} className="flex gap-3 px-4 py-3">
                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${s.badge}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{a.title}</p>
                          <p className="line-clamp-2 text-xs text-muted-foreground">{a.description}</p>
                          <Badge variant="outline" className="mt-1 h-4 px-1 text-[9px] uppercase">
                            {a.module}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Business KPIs */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Business KPIs
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-8">
          <KpiCard label="Total Customers" value={b?.totalCustomers} icon={Users} loading={loading} accent="info" />
          <KpiCard label="Active Customers" value={b?.activeCustomers} icon={UserCheck} loading={loading} accent="success" />
          <KpiCard label="Total Staff" value={b?.totalStaff} icon={Users} loading={loading} />
          <KpiCard label="Active Projects" value={b?.activeProjects} icon={FolderKanban} loading={loading} accent="info" />
          <KpiCard label="Completed Projects" value={b?.completedProjects} icon={CheckCircle2} loading={loading} accent="success" />
          <KpiCard label="Pending Projects" value={b?.pendingProjects} icon={Clock} loading={loading} accent="warning" />
          <KpiCard label="Upcoming Projects" value={b?.upcomingProjects} icon={FolderKanban} loading={loading} accent="info" />
          <KpiCard label="Overdue Tasks" value={b?.overdueTasks} icon={AlertTriangle} loading={loading} accent="danger" />
        </div>
      </div>

      <p className="pt-2 text-center text-[11px] text-muted-foreground">
        Financial figures are calculated live from database records. Modules not yet
        implemented (Phase 2+) report zero until their data lands.
      </p>
    </div>
  );
}
