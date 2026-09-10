"use client";

// ============================================================================
// LBMS Phase 9 — Management Intelligence Center
// ----------------------------------------------------------------------------
// Single unified view that consumes the 9 Phase 9 management-report APIs
// (executive, financial, customers, suppliers, projects, procurement,
// inventory, operations, workforce). READ-ONLY — no mutations.
//
// Design notes:
//  • Each tab fetches its own endpoint lazily (only when the tab is active)
//    and re-fetches whenever the preset/date-range changes.
//  • All money values arrive as exact-Decimal strings from the API; we parse
//    them for display only — never write them back.
//  • Currency symbol is fetched from /api/dashboard once on mount.
//  • Permission gate: requires `reports:view`. Falls back to EmptyState.
//  • Palette: emerald (income/positive), rose (expense/negative),
//    amber (warning), sky (info), violet (accent), zinc (neutral).
//    NO indigo / blue primary colors.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  FolderKanban,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/common/kpi-card";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

// ----------------------------------------------------------------------------
// Types — mirror the exact JSON shapes returned by the Phase 9 APIs.
// ----------------------------------------------------------------------------

interface PeriodInfo {
  from: string;
  to: string;
  preset: string;
  label: string;
}

interface ExecutiveData {
  period: PeriodInfo;
  financial: {
    totalRevenue: string;
    totalExpenses: string;
    netProfit: string;
    cashPosition: string;
    transactionCount: number;
    accountsReceivable: string | null;
    accountsPayable: string | null;
  };
  projects: {
    totalProjects: number;
    activeProjects: number;
    completedProjects: number;
    cancelledProjects: number;
    projectedRevenue: string;
    projectedCost: string;
    projectedProfit: string;
    actualRevenue: string;
    actualCost: string;
    actualProfit: string;
    actualMargin: string;
  };
  operations: {
    openTasks: number;
    overdueTasks: number;
    dueTodayTasks: number;
    completedTasks: number;
  };
  workforce: {
    totalEmployees: number;
    activeStaff: number;
    onLeaveStaff: number;
    openLeaveRequests: number;
  };
  crm: { activeCustomers: number; activeSuppliers: number };
  procurement: {
    openRequests: number;
    pendingApprovalRequests: number;
    openPurchaseOrders: number;
    poTotalValue: string;
    approvedPOValue: string;
  };
  inventory: {
    totalItems: number;
    activeWarehouses: number;
    lowStockItems: number;
    movementsInPeriod: number;
  };
}

interface CategoryRow {
  type: string;
  total: string;
  count: number;
}
interface RevenueByCustomerRow {
  customerId: string | null;
  customerNumber: string | null;
  name: string;
  revenue: string;
  transactionCount: number;
}
interface ExpenseBySupplierRow {
  supplierId: string | null;
  supplierNumber: string | null;
  name: string;
  expense: string;
  transactionCount: number;
}
interface ProjectFinanceRow {
  projectId: string;
  projectNumber: string | null;
  name: string;
  status: string | null;
  revenue: string;
  cost: string;
  profit: string;
  margin: string;
  transactionCount: number;
}
interface MonthlyTrendPoint {
  label: string;
  month: string;
  income: number;
  expense: number;
  net: number;
}
interface FinancialData {
  period: PeriodInfo;
  summary: {
    totalRevenue: string;
    totalExpenses: string;
    netProfit: string;
    transactionCount: number;
  };
  incomeByCategory: CategoryRow[];
  expenseByCategory: CategoryRow[];
  revenueByCustomer: RevenueByCustomerRow[];
  expenseBySupplier: ExpenseBySupplierRow[];
  projectFinance: ProjectFinanceRow[];
  monthlyTrend: MonthlyTrendPoint[];
}

interface CustomersData {
  period: PeriodInfo;
  totals: {
    totalCustomers: number;
    activeCustomers: number;
    customersWithRevenue: number;
  };
  topCustomers: Array<{
    customerId: string | null;
    customerNumber: string | null;
    name: string;
    status: string | null;
    revenue: string;
    transactionCount: number;
  }>;
  customersWithProjects: number;
}

interface SuppliersData {
  period: PeriodInfo;
  totals: {
    totalSuppliers: number;
    activeSuppliers: number;
    suppliersWithActivity: number;
  };
  supplierAnalytics: Array<{
    supplierId: string;
    supplierNumber: string | null;
    name: string;
    status: string | null;
    poValue: string;
    poCount: number;
    expenseValue: string;
    expenseCount: number;
  }>;
}

interface ProjectsData {
  period: PeriodInfo;
  statusDistribution: Array<{ status: string; count: number }>;
  totals: {
    totalProjects: number;
    totalRevenue: string;
    totalCost: string;
    totalProfit: string;
  };
  topProfitable: ProjectFinanceRow[];
  lowestProfit: ProjectFinanceRow[];
  allProjects: ProjectFinanceRow[];
}

interface ProcurementData {
  period: PeriodInfo;
  requestStatusDistribution: Array<{ status: string; count: number }>;
  poStatusDistribution: Array<{ status: string; count: number }>;
  totals: { poCount: number; poTotalValue: string; goodsReceipts: number };
  topSuppliersByPOValue: Array<{
    supplierId: string | null;
    supplierNumber: string | null;
    name: string;
    poValue: string;
    poCount: number;
  }>;
}

interface InventoryData {
  period: PeriodInfo;
  totals: {
    totalItems: number;
    activeWarehouses: number;
    movementsInPeriod: number;
    lowStockCount: number;
  };
  movementByType: Array<{
    movementType: string;
    count: number;
    totalQuantity: string;
  }>;
  activityByWarehouse: Array<{
    warehouseId: string | null;
    code: string | null;
    name: string;
    movementCount: number;
  }>;
  lowStockItems: Array<{
    itemId: string;
    itemCode: string;
    name: string;
    warehouseCode: string;
    warehouseName: string;
    quantity: string;
    reorderLevel: string;
    unitOfMeasure: string;
  }>;
  mostActiveItems: Array<{
    itemId: string;
    itemCode: string | null;
    name: string;
    movementCount: number;
  }>;
}

interface OperationsData {
  period: PeriodInfo;
  totals: { tasksCreated: number; overdue: number; dueToday: number };
  statusDistribution: Array<{ status: string; count: number }>;
  tasksByProject: Array<{
    projectId: string | null;
    projectNumber: string | null;
    name: string;
    taskCount: number;
  }>;
  tasksByAssignee: Array<{
    employeeId: string | null;
    name: string;
    employeeNumber: string | null;
    taskCount: number;
  }>;
}

interface WorkforceData {
  period: PeriodInfo;
  totals: {
    totalEmployees: number;
    activeEmployees: number;
    onLeave: number;
    probation: number;
    pendingLeaveRequests: number;
    approvedLeaveInPeriod: number;
    performanceReviewsInPeriod: number;
  };
  employeesByDepartment: Array<{
    departmentId: string | null;
    name: string;
    code: string | null;
    employeeCount: number;
  }>;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const PRESET_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "quarter", label: "This Quarter" },
  { value: "year", label: "This Year" },
  { value: "prev_month", label: "Previous Month" },
  { value: "prev_quarter", label: "Previous Quarter" },
  { value: "prev_year", label: "Previous Year" },
  { value: "custom", label: "Custom Range" },
];

const TABS = [
  "executive",
  "financial",
  "customers",
  "suppliers",
  "projects",
  "procurement",
  "inventory",
  "operations",
  "workforce",
] as const;
type TabKey = (typeof TABS)[number];

const TAB_LABELS: Record<TabKey, string> = {
  executive: "Executive",
  financial: "Financial",
  customers: "Customers",
  suppliers: "Suppliers",
  projects: "Projects",
  procurement: "Procurement",
  inventory: "Inventory",
  operations: "Operations",
  workforce: "Workforce",
};

// Chart palette — explicitly avoids indigo/blue primary colors.
const CHART_COLORS = {
  emerald: "oklch(0.55 0.14 162)",
  rose: "oklch(0.65 0.2 25)",
  sky: "oklch(0.62 0.14 230)",
  amber: "oklch(0.7 0.15 70)",
  violet: "oklch(0.55 0.18 290)",
  zinc: "oklch(0.55 0.01 260)",
};

const PIE_PALETTE = [
  CHART_COLORS.emerald,
  CHART_COLORS.sky,
  CHART_COLORS.amber,
  CHART_COLORS.violet,
  CHART_COLORS.rose,
  CHART_COLORS.zinc,
];

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function formatMoney(amount: string | number | null | undefined, symbol: string) {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!isFinite(n)) return "—";
  return `${symbol}${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatNumber(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

function formatPercent(v: string | number | null | undefined) {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!isFinite(n)) return "—";
  return `${n.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function titleCase(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Badge colors by domain status. NO indigo/blue primary colors.
function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (["active", "completed", "approved", "received", "posted"].includes(s)) {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  }
  if (
    ["pending", "pending_approval", "submitted", "on_hold", "on_leave", "probation", "partially_received", "in_progress"].includes(s)
  ) {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
  }
  if (["cancelled", "rejected", "overdue", "void"].includes(s)) {
    return "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30";
  }
  if (["planning", "todo", "draft", "sent"].includes(s)) {
    return "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30";
  }
  return "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/30";
}

// ----------------------------------------------------------------------------
// useReport — small fetcher hook with cancellation, error toasts and a
// refresh nonce so the parent "Refresh" button can force a refetch.
// ----------------------------------------------------------------------------

function useReport<T>(
  endpoint: string,
  query: string,
  enabled: boolean,
  refreshNonce: number,
): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`${endpoint}?${query}`);
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as T;
        if (!cancelled) {
          setData(json);
        }
      } catch (e) {
        if (!cancelled) {
          toast.error(
            e instanceof Error
              ? `Failed to load report: ${e.message}`
              : "Failed to load report.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint, query, enabled, refreshNonce]);

  return { data, loading };
}

// ----------------------------------------------------------------------------
// Shared small UI atoms
// ----------------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function InlineEmpty({ message = "No data for this period." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
      <Activity className="h-7 w-7 opacity-30" />
      <p className="text-xs">{message}</p>
    </div>
  );
}

function PeriodBadge({ period }: { period?: PeriodInfo }) {
  if (!period) return null;
  return (
    <Badge variant="outline" className="text-[11px] font-normal">
      {period.label}
    </Badge>
  );
}

function LoadingRowSkeleton({ cols = 4 }: { cols?: number }) {
  return (
    <TableRow>
      {Array.from({ length: cols }).map((_, i) => (
        <TableCell key={i}>
          <Skeleton className="h-4 w-full max-w-[120px]" />
        </TableCell>
      ))}
    </TableRow>
  );
}

// ----------------------------------------------------------------------------
// EXECUTIVE TAB
// ----------------------------------------------------------------------------

function ExecutiveTab({
  query,
  symbol,
  refreshNonce,
}: {
  query: string;
  symbol: string;
  refreshNonce: number;
}) {
  const { data, loading } = useReport<ExecutiveData>(
    "/api/reports/management/executive",
    query,
    true,
    refreshNonce,
  );
  const f = data?.financial;
  const p = data?.projects;
  const o = data?.operations;
  const w = data?.workforce;
  const crm = data?.crm;
  const proc = data?.procurement;
  const inv = data?.inventory;

  const netPositive = f ? Number(f.netProfit) >= 0 : true;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Executive KPI Summary</SectionTitle>
        <PeriodBadge period={data?.period} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Revenue"
          value={f ? formatMoney(f.totalRevenue, symbol) : undefined}
          icon={TrendingUp}
          accent="success"
          loading={loading}
          hint="Income in selected period"
        />
        <KpiCard
          label="Total Expenses"
          value={f ? formatMoney(f.totalExpenses, symbol) : undefined}
          icon={TrendingDown}
          accent="danger"
          loading={loading}
          hint="Expenditure in selected period"
        />
        <KpiCard
          label="Net Profit"
          value={f ? formatMoney(f.netProfit, symbol) : undefined}
          icon={Wallet}
          accent={netPositive ? "success" : "danger"}
          loading={loading}
          hint={f ? `${formatNumber(f.transactionCount)} transactions` : undefined}
        />
        <KpiCard
          label="Cash Position"
          value={f ? formatMoney(f.cashPosition, symbol) : undefined}
          icon={Wallet}
          accent="info"
          loading={loading}
          hint="Total across all active accounts"
        />
        <KpiCard
          label="Active Projects"
          value={p?.activeProjects}
          icon={FolderKanban}
          accent="info"
          loading={loading}
          hint={p ? `${formatNumber(p.totalProjects)} total` : undefined}
        />
        <KpiCard
          label="Open Tasks"
          value={o?.openTasks}
          icon={Activity}
          loading={loading}
          hint={o ? `${formatNumber(o.completedTasks)} completed` : undefined}
        />
        <KpiCard
          label="Overdue Tasks"
          value={o?.overdueTasks}
          icon={AlertTriangle}
          accent={(o?.overdueTasks ?? 0) > 0 ? "danger" : "default"}
          loading={loading}
          hint={o ? `${formatNumber(o.dueTodayTasks)} due today` : undefined}
        />
        <KpiCard
          label="Active Employees"
          value={w?.activeStaff}
          icon={Users}
          accent="info"
          loading={loading}
          hint={w ? `${formatNumber(w.onLeaveStaff)} on leave` : undefined}
        />
        <KpiCard
          label="Inventory Items"
          value={inv?.totalItems}
          icon={Boxes}
          loading={loading}
          hint={inv ? `${formatNumber(inv.activeWarehouses)} active warehouses` : undefined}
        />
        <KpiCard
          label="Low Stock Items"
          value={inv?.lowStockItems}
          icon={AlertTriangle}
          accent={(inv?.lowStockItems ?? 0) > 0 ? "warning" : "default"}
          loading={loading}
          hint={inv ? `${formatNumber(inv.movementsInPeriod)} movements in period` : undefined}
        />
        <KpiCard
          label="Open POs"
          value={proc?.openPurchaseOrders}
          icon={Truck}
          loading={loading}
          hint={proc ? `${formatNumber(proc.openRequests)} open requests` : undefined}
        />
        <KpiCard
          label="PO Total Value"
          value={proc ? formatMoney(proc.poTotalValue, symbol) : undefined}
          icon={Truck}
          accent="info"
          loading={loading}
          hint={proc ? `${formatMoney(proc.approvedPOValue, symbol)} approved` : undefined}
        />
      </div>

      {/* Supplementary tiles: CRM + project projection + finance AR/AP deferred */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">CRM at a Glance</CardTitle>
            <CardDescription className="text-xs">
              Active counterparties in the selected period
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Active Customers</span>
              {loading ? <Skeleton className="h-5 w-10" /> : <Badge className="bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30">{formatNumber(crm?.activeCustomers)}</Badge>}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Active Suppliers</span>
              {loading ? <Skeleton className="h-5 w-10" /> : <Badge className="bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30">{formatNumber(crm?.activeSuppliers)}</Badge>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project Portfolio</CardTitle>
            <CardDescription className="text-xs">
              Projected vs actual financials
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-muted/60 p-2">
                    <p className="text-muted-foreground">Projected Revenue</p>
                    <p className="mt-0.5 font-semibold">{formatMoney(p?.projectedRevenue, symbol)}</p>
                  </div>
                  <div className="rounded-md bg-muted/60 p-2">
                    <p className="text-muted-foreground">Projected Cost</p>
                    <p className="mt-0.5 font-semibold">{formatMoney(p?.projectedCost, symbol)}</p>
                  </div>
                  <div className="rounded-md bg-muted/60 p-2">
                    <p className="text-muted-foreground">Actual Revenue</p>
                    <p className="mt-0.5 font-semibold text-emerald-700 dark:text-emerald-400">{formatMoney(p?.actualRevenue, symbol)}</p>
                  </div>
                  <div className="rounded-md bg-muted/60 p-2">
                    <p className="text-muted-foreground">Actual Profit</p>
                    <p className={`mt-0.5 font-semibold ${p && Number(p.actualProfit) >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>{formatMoney(p?.actualProfit, symbol)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1 text-xs">
                  <span className="text-muted-foreground">Actual Margin</span>
                  <span className="font-medium">{formatPercent(p?.actualMargin)}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Receivables &amp; Payables</CardTitle>
            <CardDescription className="text-xs">
              AR / AP aggregation status
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Accounts Receivable</span>
              {loading ? <Skeleton className="h-5 w-16" /> : (
                <Badge variant="outline" className="bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 border-zinc-500/30 text-[10px]">
                  Deferred
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Accounts Payable</span>
              {loading ? <Skeleton className="h-5 w-16" /> : (
                <Badge variant="outline" className="bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 border-zinc-500/30 text-[10px]">
                  Deferred
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              AR / AP aggregation is not yet enabled — these figures will appear
              once invoicing &amp; billing modules are live.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// FINANCIAL TAB
// ----------------------------------------------------------------------------

function FinancialTab({
  query,
  symbol,
  refreshNonce,
}: {
  query: string;
  symbol: string;
  refreshNonce: number;
}) {
  const { data, loading } = useReport<FinancialData>(
    "/api/reports/management/financial",
    query,
    true,
    refreshNonce,
  );
  const s = data?.summary;
  const trend = data?.monthlyTrend ?? [];
  const hasTrend = trend.some((d) => d.income > 0 || d.expense > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Financial Summary</SectionTitle>
        <PeriodBadge period={data?.period} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Revenue"
          value={s ? formatMoney(s.totalRevenue, symbol) : undefined}
          icon={TrendingUp}
          accent="success"
          loading={loading}
          hint={s ? `${formatNumber(s.transactionCount)} transactions` : undefined}
        />
        <KpiCard
          label="Total Expenses"
          value={s ? formatMoney(s.totalExpenses, symbol) : undefined}
          icon={TrendingDown}
          accent="danger"
          loading={loading}
        />
        <KpiCard
          label="Net Profit"
          value={s ? formatMoney(s.netProfit, symbol) : undefined}
          icon={Wallet}
          accent={s && Number(s.netProfit) >= 0 ? "success" : "danger"}
          loading={loading}
          hint="Revenue − Expenses"
        />
      </div>

      {/* Monthly Trend chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Trend · last 12 months</CardTitle>
          <CardDescription className="text-xs">
            Income vs Expense vs Net per month
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : hasTrend ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="finIncome" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.emerald} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={CHART_COLORS.emerald} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="finExpense" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.rose} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={CHART_COLORS.rose} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="finNet" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.sky} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={CHART_COLORS.sky} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={56} className="text-muted-foreground" />
                  <ReTooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                    formatter={(value: number) => formatMoney(value, symbol)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="income" stroke={CHART_COLORS.emerald} strokeWidth={2} fill="url(#finIncome)" name="Income" />
                  <Area type="monotone" dataKey="expense" stroke={CHART_COLORS.rose} strokeWidth={2} fill="url(#finExpense)" name="Expense" />
                  <Area type="monotone" dataKey="net" stroke={CHART_COLORS.sky} strokeWidth={2} fill="url(#finNet)" name="Net" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <InlineEmpty message="No financial activity in the last 12 months." />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Category breakdowns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CategoryTableCard
          title="Income by Category"
          description="Posted income journals grouped by type"
          rows={data?.incomeByCategory ?? []}
          loading={loading}
          symbol={symbol}
          amountKey="total"
          countKey="count"
          labelKey="type"
          amountLabel="Income"
          accentClass="text-emerald-700 dark:text-emerald-400"
        />
        <CategoryTableCard
          title="Expense by Category"
          description="Posted expense journals grouped by type"
          rows={data?.expenseByCategory ?? []}
          loading={loading}
          symbol={symbol}
          amountKey="total"
          countKey="count"
          labelKey="type"
          amountLabel="Expense"
          accentClass="text-rose-700 dark:text-rose-400"
        />
      </div>

      {/* Revenue by customer + Expense by supplier */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue by Customer · Top 10</CardTitle>
            <CardDescription className="text-xs">Posted income grouped by customer</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Txns</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <LoadingRowSkeleton cols={3} />
                  ) : (data?.revenueByCustomer ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3}><InlineEmpty /></TableCell>
                    </TableRow>
                  ) : (
                    (data?.revenueByCustomer ?? []).map((r) => (
                      <TableRow key={r.customerId ?? r.name}>
                        <TableCell className="font-medium">
                          {r.name}
                          {r.customerNumber && (
                            <span className="ml-1 text-[11px] text-muted-foreground">#{r.customerNumber}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(r.revenue, symbol)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(r.transactionCount)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expense by Supplier · Top 10</CardTitle>
            <CardDescription className="text-xs">Posted expense grouped by supplier</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">Expense</TableHead>
                    <TableHead className="text-right">Txns</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <LoadingRowSkeleton cols={3} />
                  ) : (data?.expenseBySupplier ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3}><InlineEmpty /></TableCell>
                    </TableRow>
                  ) : (
                    (data?.expenseBySupplier ?? []).map((r) => (
                      <TableRow key={r.supplierId ?? r.name}>
                        <TableCell className="font-medium">
                          {r.name}
                          {r.supplierNumber && (
                            <span className="ml-1 text-[11px] text-muted-foreground">#{r.supplierNumber}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(r.expense, symbol)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(r.transactionCount)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Project finance table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project Finance</CardTitle>
          <CardDescription className="text-xs">
            Per-project revenue, cost, profit &amp; margin in the selected period
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Txns</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <LoadingRowSkeleton cols={7} />
                ) : (data?.projectFinance ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}><InlineEmpty /></TableCell>
                  </TableRow>
                ) : (
                  (data?.projectFinance ?? []).map((r) => (
                    <TableRow key={r.projectId}>
                      <TableCell className="font-medium">
                        {r.name}
                        {r.projectNumber && (
                          <span className="ml-1 text-[11px] text-muted-foreground">#{r.projectNumber}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.status ? (
                          <Badge variant="outline" className={statusBadgeClass(r.status)}>
                            {titleCase(r.status)}
                          </Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(r.revenue, symbol)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(r.cost, symbol)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${Number(r.profit) >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>{formatMoney(r.profit, symbol)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPercent(r.margin)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(r.transactionCount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CategoryTableCard({
  title,
  description,
  rows,
  loading,
  symbol,
  amountKey,
  countKey,
  labelKey,
  amountLabel,
  accentClass,
}: {
  title: string;
  description: string;
  rows: CategoryRow[];
  loading: boolean;
  symbol: string;
  amountKey: "total";
  countKey: "count";
  labelKey: "type";
  amountLabel: string;
  accentClass: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">{amountLabel}</TableHead>
                <TableHead className="text-right">Txns</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <LoadingRowSkeleton cols={3} />
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3}><InlineEmpty /></TableCell>
                </TableRow>
              ) : (
                rows.map((r, i) => (
                  <TableRow key={`${r.type}-${i}`}>
                    <TableCell className="font-medium">{titleCase(r.type ?? "—")}</TableCell>
                    <TableCell className={`text-right tabular-nums ${accentClass}`}>{formatMoney(r.total, symbol)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(r.count)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// CUSTOMERS TAB
// ----------------------------------------------------------------------------

function CustomersTab({
  query,
  symbol,
  refreshNonce,
}: {
  query: string;
  symbol: string;
  refreshNonce: number;
}) {
  const { data, loading } = useReport<CustomersData>(
    "/api/reports/management/customers",
    query,
    true,
    refreshNonce,
  );
  const t = data?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Customer Analytics</SectionTitle>
        <PeriodBadge period={data?.period} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Customers" value={t?.totalCustomers} icon={Users} accent="info" loading={loading} />
        <KpiCard label="Active Customers" value={t?.activeCustomers} icon={Users} accent="success" loading={loading} />
        <KpiCard label="Customers w/ Revenue" value={t?.customersWithRevenue} icon={TrendingUp} accent="success" loading={loading} hint="In selected period" />
        <KpiCard label="Customers w/ Projects" value={data?.customersWithProjects} icon={FolderKanban} accent="info" loading={loading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Customers · by revenue</CardTitle>
          <CardDescription className="text-xs">Top 20 customers by posted income in the period</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <LoadingRowSkeleton cols={4} />
                ) : (data?.topCustomers ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4}><InlineEmpty /></TableCell>
                  </TableRow>
                ) : (
                  (data?.topCustomers ?? []).map((r) => (
                    <TableRow key={r.customerId ?? r.name}>
                      <TableCell className="font-medium">
                        {r.name}
                        {r.customerNumber && (
                          <span className="ml-1 text-[11px] text-muted-foreground">#{r.customerNumber}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.status ? (
                          <Badge variant="outline" className={statusBadgeClass(r.status)}>
                            {titleCase(r.status)}
                          </Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{formatMoney(r.revenue, symbol)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(r.transactionCount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// SUPPLIERS TAB
// ----------------------------------------------------------------------------

function SuppliersTab({
  query,
  symbol,
  refreshNonce,
}: {
  query: string;
  symbol: string;
  refreshNonce: number;
}) {
  const { data, loading } = useReport<SuppliersData>(
    "/api/reports/management/suppliers",
    query,
    true,
    refreshNonce,
  );
  const t = data?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Supplier Analytics</SectionTitle>
        <PeriodBadge period={data?.period} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Total Suppliers" value={t?.totalSuppliers} icon={Truck} accent="info" loading={loading} />
        <KpiCard label="Active Suppliers" value={t?.activeSuppliers} icon={CheckCircle2} accent="success" loading={loading} />
        <KpiCard label="Suppliers w/ Activity" value={t?.suppliersWithActivity} icon={Activity} loading={loading} hint="PO or expense in period" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Supplier Analytics</CardTitle>
          <CardDescription className="text-xs">
            PO spend &amp; expense by supplier in the selected period
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">PO Value</TableHead>
                  <TableHead className="text-right">PO Count</TableHead>
                  <TableHead className="text-right">Expense</TableHead>
                  <TableHead className="text-right">Expense Txns</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <LoadingRowSkeleton cols={6} />
                ) : (data?.supplierAnalytics ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}><InlineEmpty /></TableCell>
                  </TableRow>
                ) : (
                  (data?.supplierAnalytics ?? []).map((r) => (
                    <TableRow key={r.supplierId}>
                      <TableCell className="font-medium">
                        {r.name}
                        {r.supplierNumber && (
                          <span className="ml-1 text-[11px] text-muted-foreground">#{r.supplierNumber}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.status ? (
                          <Badge variant="outline" className={statusBadgeClass(r.status)}>
                            {titleCase(r.status)}
                          </Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(r.poValue, symbol)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(r.poCount)}</TableCell>
                      <TableCell className="text-right tabular-nums text-rose-700 dark:text-rose-400">{formatMoney(r.expenseValue, symbol)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(r.expenseCount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// PROJECTS TAB
// ----------------------------------------------------------------------------

function ProjectsTab({
  query,
  symbol,
  refreshNonce,
}: {
  query: string;
  symbol: string;
  refreshNonce: number;
}) {
  const { data, loading } = useReport<ProjectsData>(
    "/api/reports/management/projects",
    query,
    true,
    refreshNonce,
  );

  const statusDist = data?.statusDistribution ?? [];
  const totals = data?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Project Analytics</SectionTitle>
        <PeriodBadge period={data?.period} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status Distribution</CardTitle>
          <CardDescription className="text-xs">
            All projects grouped by current status
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-8 w-full" />
          ) : statusDist.length === 0 ? (
            <InlineEmpty />
          ) : (
            <div className="flex flex-wrap gap-2">
              {statusDist.map((s) => (
                <Badge key={s.status} variant="outline" className={`gap-1.5 py-1 ${statusBadgeClass(s.status)}`}>
                  <span className="text-[11px]">{titleCase(s.status)}</span>
                  <span className="rounded bg-background/60 px-1 text-[10px] font-semibold tabular-nums">{formatNumber(s.count)}</span>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Projects" value={totals?.totalProjects} icon={FolderKanban} accent="info" loading={loading} />
        <KpiCard label="Total Revenue" value={totals ? formatMoney(totals.totalRevenue, symbol) : undefined} icon={TrendingUp} accent="success" loading={loading} />
        <KpiCard label="Total Cost" value={totals ? formatMoney(totals.totalCost, symbol) : undefined} icon={TrendingDown} accent="danger" loading={loading} />
        <KpiCard
          label="Total Profit"
          value={totals ? formatMoney(totals.totalProfit, symbol) : undefined}
          icon={Wallet}
          accent={totals && Number(totals.totalProfit) >= 0 ? "success" : "danger"}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ProjectFinanceTable
          title="Top Profitable Projects"
          description="Sorted by actual profit (descending)"
          rows={data?.topProfitable ?? []}
          loading={loading}
          symbol={symbol}
        />
        <ProjectFinanceTable
          title="Lowest Profit Projects"
          description="Bottom 10 by actual profit"
          rows={data?.lowestProfit ?? []}
          loading={loading}
          symbol={symbol}
        />
      </div>
    </div>
  );
}

function ProjectFinanceTable({
  title,
  description,
  rows,
  loading,
  symbol,
}: {
  title: string;
  description: string;
  rows: ProjectFinanceRow[];
  loading: boolean;
  symbol: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <LoadingRowSkeleton cols={5} />
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}><InlineEmpty /></TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.projectId}>
                    <TableCell className="font-medium">
                      {r.name}
                      {r.projectNumber && (
                        <span className="ml-1 text-[11px] text-muted-foreground">#{r.projectNumber}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.revenue, symbol)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.cost, symbol)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${Number(r.profit) >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>{formatMoney(r.profit, symbol)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(r.margin)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// PROCUREMENT TAB
// ----------------------------------------------------------------------------

function ProcurementTab({
  query,
  symbol,
  refreshNonce,
}: {
  query: string;
  symbol: string;
  refreshNonce: number;
}) {
  const { data, loading } = useReport<ProcurementData>(
    "/api/reports/management/procurement",
    query,
    true,
    refreshNonce,
  );
  const t = data?.totals;
  const reqDist = data?.requestStatusDistribution ?? [];
  const poDist = data?.poStatusDistribution ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Procurement Analytics</SectionTitle>
        <PeriodBadge period={data?.period} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Purchase Orders" value={t?.poCount} icon={Truck} accent="info" loading={loading} hint="In selected period" />
        <KpiCard label="PO Total Value" value={t ? formatMoney(t.poTotalValue, symbol) : undefined} icon={Wallet} accent="success" loading={loading} />
        <KpiCard label="Goods Receipts" value={t?.goodsReceipts} icon={Boxes} loading={loading} hint="Receipts in period" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Request Status Distribution</CardTitle>
            <CardDescription className="text-xs">Procurement requests by status</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-full" />
            ) : reqDist.length === 0 ? (
              <InlineEmpty />
            ) : (
              <div className="flex flex-wrap gap-2">
                {reqDist.map((s) => (
                  <Badge key={s.status} variant="outline" className={`gap-1.5 py-1 ${statusBadgeClass(s.status)}`}>
                    <span className="text-[11px]">{titleCase(s.status)}</span>
                    <span className="rounded bg-background/60 px-1 text-[10px] font-semibold tabular-nums">{formatNumber(s.count)}</span>
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">PO Status Distribution</CardTitle>
            <CardDescription className="text-xs">Purchase orders by status</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-full" />
            ) : poDist.length === 0 ? (
              <InlineEmpty />
            ) : (
              <div className="flex flex-wrap gap-2">
                {poDist.map((s) => (
                  <Badge key={s.status} variant="outline" className={`gap-1.5 py-1 ${statusBadgeClass(s.status)}`}>
                    <span className="text-[11px]">{titleCase(s.status)}</span>
                    <span className="rounded bg-background/60 px-1 text-[10px] font-semibold tabular-nums">{formatNumber(s.count)}</span>
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Suppliers by PO Value</CardTitle>
          <CardDescription className="text-xs">Top 10 suppliers ranked by PO total in the selected period</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">PO Value</TableHead>
                  <TableHead className="text-right">PO Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <LoadingRowSkeleton cols={3} />
                ) : (data?.topSuppliersByPOValue ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3}><InlineEmpty /></TableCell>
                  </TableRow>
                ) : (
                  (data?.topSuppliersByPOValue ?? []).map((r) => (
                    <TableRow key={r.supplierId ?? r.name}>
                      <TableCell className="font-medium">
                        {r.name}
                        {r.supplierNumber && (
                          <span className="ml-1 text-[11px] text-muted-foreground">#{r.supplierNumber}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(r.poValue, symbol)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(r.poCount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// INVENTORY TAB
// ----------------------------------------------------------------------------

function InventoryTab({
  query,
  symbol: _symbol,
  refreshNonce,
}: {
  query: string;
  symbol: string;
  refreshNonce: number;
}) {
  const { data, loading } = useReport<InventoryData>(
    "/api/reports/management/inventory",
    query,
    true,
    refreshNonce,
  );
  const t = data?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Inventory Analytics</SectionTitle>
        <PeriodBadge period={data?.period} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Items" value={t?.totalItems} icon={Boxes} loading={loading} />
        <KpiCard label="Active Warehouses" value={t?.activeWarehouses} icon={Truck} accent="info" loading={loading} />
        <KpiCard label="Movements in Period" value={t?.movementsInPeriod} icon={Activity} accent="info" loading={loading} />
        <KpiCard
          label="Low Stock Items"
          value={t?.lowStockCount}
          icon={AlertTriangle}
          accent={(t?.lowStockCount ?? 0) > 0 ? "warning" : "default"}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Movement by Type</CardTitle>
            <CardDescription className="text-xs">Stock movements grouped by movement type</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Total Quantity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <LoadingRowSkeleton cols={3} />
                  ) : (data?.movementByType ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3}><InlineEmpty /></TableCell>
                    </TableRow>
                  ) : (
                    (data?.movementByType ?? []).map((r) => (
                      <TableRow key={r.movementType}>
                        <TableCell>
                          <Badge variant="outline" className={statusBadgeClass(r.movementType)}>
                            {titleCase(r.movementType)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(r.count)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(Number(r.totalQuantity))}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity by Warehouse</CardTitle>
            <CardDescription className="text-xs">Movements per warehouse in the selected period</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Warehouse</TableHead>
                    <TableHead className="text-right">Movements</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <LoadingRowSkeleton cols={2} />
                  ) : (data?.activityByWarehouse ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2}><InlineEmpty /></TableCell>
                    </TableRow>
                  ) : (
                    (data?.activityByWarehouse ?? []).map((r) => (
                      <TableRow key={r.warehouseId ?? r.code ?? r.name}>
                        <TableCell className="font-medium">
                          {r.name}
                          {r.code && (
                            <span className="ml-1 text-[11px] text-muted-foreground">#{r.code}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(r.movementCount)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Low-Stock Items</CardTitle>
          <CardDescription className="text-xs">Balances where current quantity ≤ reorder level</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Reorder Level</TableHead>
                  <TableHead>UoM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <LoadingRowSkeleton cols={6} />
                ) : (data?.lowStockItems ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}><InlineEmpty message="No low-stock items — all healthy." /></TableCell>
                  </TableRow>
                ) : (
                  (data?.lowStockItems ?? []).map((r) => (
                    <TableRow key={`${r.itemId}-${r.warehouseCode}`} className="bg-amber-50/40 dark:bg-amber-500/5">
                      <TableCell className="font-medium tabular-nums">{r.itemCode}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>{r.warehouseName} <span className="text-[11px] text-muted-foreground">#{r.warehouseCode}</span></TableCell>
                      <TableCell className="text-right tabular-nums text-amber-700 dark:text-amber-400">{formatNumber(Number(r.quantity))}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(Number(r.reorderLevel))}</TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">{r.unitOfMeasure}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Most Active Items</CardTitle>
          <CardDescription className="text-xs">Top 10 items by movement count in the period</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Movements</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <LoadingRowSkeleton cols={3} />
                ) : (data?.mostActiveItems ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3}><InlineEmpty /></TableCell>
                  </TableRow>
                ) : (
                  (data?.mostActiveItems ?? []).map((r) => (
                    <TableRow key={r.itemId}>
                      <TableCell className="font-medium tabular-nums">{r.itemCode ?? "—"}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(r.movementCount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// OPERATIONS TAB
// ----------------------------------------------------------------------------

function OperationsTab({
  query,
  symbol: _symbol,
  refreshNonce,
}: {
  query: string;
  symbol: string;
  refreshNonce: number;
}) {
  const { data, loading } = useReport<OperationsData>(
    "/api/reports/management/operations",
    query,
    true,
    refreshNonce,
  );
  const t = data?.totals;
  const dist = data?.statusDistribution ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Operations Analytics</SectionTitle>
        <PeriodBadge period={data?.period} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Tasks Created" value={t?.tasksCreated} icon={Activity} accent="info" loading={loading} hint="In selected period" />
        <KpiCard
          label="Overdue Tasks"
          value={t?.overdue}
          icon={AlertTriangle}
          accent={(t?.overdue ?? 0) > 0 ? "danger" : "default"}
          loading={loading}
        />
        <KpiCard label="Due Today" value={t?.dueToday} icon={CheckCircle2} accent="warning" loading={loading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Task Status Distribution</CardTitle>
          <CardDescription className="text-xs">Tasks created in the period, by status</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-8 w-full" />
          ) : dist.length === 0 ? (
            <InlineEmpty />
          ) : (
            <div className="flex flex-wrap gap-2">
              {dist.map((s) => (
                <Badge key={s.status} variant="outline" className={`gap-1.5 py-1 ${statusBadgeClass(s.status)}`}>
                  <span className="text-[11px]">{titleCase(s.status)}</span>
                  <span className="rounded bg-background/60 px-1 text-[10px] font-semibold tabular-nums">{formatNumber(s.count)}</span>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks by Project · Top 10</CardTitle>
            <CardDescription className="text-xs">Tasks created in the period, grouped by project</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Tasks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <LoadingRowSkeleton cols={2} />
                  ) : (data?.tasksByProject ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2}><InlineEmpty /></TableCell>
                    </TableRow>
                  ) : (
                    (data?.tasksByProject ?? []).map((r) => (
                      <TableRow key={r.projectId ?? r.name}>
                        <TableCell className="font-medium">
                          {r.name}
                          {r.projectNumber && (
                            <span className="ml-1 text-[11px] text-muted-foreground">#{r.projectNumber}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(r.taskCount)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks by Assignee · Top 10</CardTitle>
            <CardDescription className="text-xs">Tasks created in the period, grouped by assigned employee</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Assignee</TableHead>
                    <TableHead className="text-right">Tasks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <LoadingRowSkeleton cols={2} />
                  ) : (data?.tasksByAssignee ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2}><InlineEmpty /></TableCell>
                    </TableRow>
                  ) : (
                    (data?.tasksByAssignee ?? []).map((r) => (
                      <TableRow key={r.employeeId ?? r.name}>
                        <TableCell className="font-medium">
                          {r.name}
                          {r.employeeNumber && (
                            <span className="ml-1 text-[11px] text-muted-foreground">#{r.employeeNumber}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(r.taskCount)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// WORKFORCE TAB
// ----------------------------------------------------------------------------

function WorkforceTab({
  query,
  symbol: _symbol,
  refreshNonce,
}: {
  query: string;
  symbol: string;
  refreshNonce: number;
}) {
  const { data, loading } = useReport<WorkforceData>(
    "/api/reports/management/workforce",
    query,
    true,
    refreshNonce,
  );
  const t = data?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Workforce Analytics</SectionTitle>
        <PeriodBadge period={data?.period} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard label="Total Employees" value={t?.totalEmployees} icon={Users} accent="info" loading={loading} />
        <KpiCard label="Active Employees" value={t?.activeEmployees} icon={CheckCircle2} accent="success" loading={loading} />
        <KpiCard label="On Leave" value={t?.onLeave} icon={Activity} accent="warning" loading={loading} />
        <KpiCard label="Probation" value={t?.probation} icon={Users} loading={loading} />
        <KpiCard label="Pending Leave Requests" value={t?.pendingLeaveRequests} icon={AlertTriangle} accent={(t?.pendingLeaveRequests ?? 0) > 0 ? "warning" : "default"} loading={loading} />
        <KpiCard label="Approved Leave in Period" value={t?.approvedLeaveInPeriod} icon={CheckCircle2} accent="success" loading={loading} />
        <KpiCard label="Performance Reviews" value={t?.performanceReviewsInPeriod} icon={Activity} accent="info" loading={loading} hint="In selected period" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employees by Department</CardTitle>
          <CardDescription className="text-xs">Headcount distribution across departments</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead className="text-right">Employees</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <LoadingRowSkeleton cols={3} />
                ) : (data?.employeesByDepartment ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3}><InlineEmpty /></TableCell>
                  </TableRow>
                ) : (
                  (data?.employeesByDepartment ?? []).map((r) => (
                    <TableRow key={r.departmentId ?? r.name}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">{r.code ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(r.employeeCount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// MAIN VIEW
// ----------------------------------------------------------------------------

export function ManagementReportsView() {
  const { can } = useAuth();
  const canView = can("reports", "view");

  const [preset, setPreset] = useState<string>("month");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [tab, setTab] = useState<TabKey>("executive");
  const [refreshNonce, setRefreshNonce] = useState<number>(0);

  // Currency symbol — fetched once from the dashboard API.
  const [symbol, setSymbol] = useState<string>("GH₵");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dashboard");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json?.currencySymbol) {
          setSymbol(json.currencySymbol);
        }
      } catch {
        // Silent — fallback symbol is fine.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build the query string for the active tab's fetcher. All tabs share the
  // same preset/range so that switching tabs is instant (the hook re-fetches
  // only when this query changes or when the tab becomes active).
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (preset === "custom" && customFrom && customTo) {
      params.set("preset", "custom");
      params.set("from", customFrom);
      params.set("to", customTo);
    } else {
      params.set("preset", preset);
    }
    return params.toString();
  }, [preset, customFrom, customTo]);

  const onRefresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
    toast.success("Reports refreshed.");
  }, []);

  // Permission gate — required by spec.
  if (!canView) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="You do not have permission to view management reports."
        description="Contact your administrator if you believe this is an error."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Management Intelligence Center"
        description="Unified business analytics across all modules"
      />

      {/* Filter bar */}
      <Card>
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="preset-select" className="text-xs text-muted-foreground">
                  Date Range
                </Label>
                <Select value={preset} onValueChange={setPreset}>
                  <SelectTrigger
                    id="preset-select"
                    data-testid="preset-select"
                    className="w-full sm:w-[200px]"
                  >
                    <SelectValue placeholder="Select range" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESET_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {preset === "custom" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="custom-from" className="text-xs text-muted-foreground">
                      From
                    </Label>
                    <Input
                      id="custom-from"
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="w-full sm:w-[160px]"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="custom-to" className="text-xs text-muted-foreground">
                      To
                    </Label>
                    <Input
                      id="custom-to"
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="w-full sm:w-[160px]"
                    />
                  </div>
                </>
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={onRefresh}
              className="gap-2 self-start sm:self-auto"
              data-testid="refresh-reports"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>

          {preset === "custom" && (!customFrom || !customTo) && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Select both &ldquo;From&rdquo; and &ldquo;To&rdquo; dates to apply a custom range.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList className="h-auto flex-wrap">
            {TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="executive">
          <ExecutiveTab query={query} symbol={symbol} refreshNonce={refreshNonce} />
        </TabsContent>
        <TabsContent value="financial">
          <FinancialTab query={query} symbol={symbol} refreshNonce={refreshNonce} />
        </TabsContent>
        <TabsContent value="customers">
          <CustomersTab query={query} symbol={symbol} refreshNonce={refreshNonce} />
        </TabsContent>
        <TabsContent value="suppliers">
          <SuppliersTab query={query} symbol={symbol} refreshNonce={refreshNonce} />
        </TabsContent>
        <TabsContent value="projects">
          <ProjectsTab query={query} symbol={symbol} refreshNonce={refreshNonce} />
        </TabsContent>
        <TabsContent value="procurement">
          <ProcurementTab query={query} symbol={symbol} refreshNonce={refreshNonce} />
        </TabsContent>
        <TabsContent value="inventory">
          <InventoryTab query={query} symbol={symbol} refreshNonce={refreshNonce} />
        </TabsContent>
        <TabsContent value="operations">
          <OperationsTab query={query} symbol={symbol} refreshNonce={refreshNonce} />
        </TabsContent>
        <TabsContent value="workforce">
          <WorkforceTab query={query} symbol={symbol} refreshNonce={refreshNonce} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
