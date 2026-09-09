"use client";

// ============================================================================
// LBMS Finance Overview — landing view for the finance module
// ----------------------------------------------------------------------------
// Pulls together: KPI cards (income/expense/net/cash), a period-scoped
// income-vs-expense comparison chart, account balances, recent transactions,
// and per-category breakdowns. Period defaults to "this month".
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Scale,
  Activity,
  Receipt,
  PiggyBank,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/common/kpi-card";
import { EmptyState } from "@/components/common/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types (mirror API contracts)
// ---------------------------------------------------------------------------
interface SummaryResponse {
  totalIncome: string;
  totalExpenses: string;
  netMovement: string;
  cashPosition: string;
  incomeByType: { type: string; total: string; count: number }[];
  expenseByType: { type: string; total: string; count: number }[];
  transactionCount: number;
  period: { from?: string; to?: string };
}

interface AccountBalance {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  currency: string;
  openingBalance: string;
  postedDebits: string;
  postedCredits: string;
  balance: string;
  transactionCount: number;
}

interface RecentTransaction {
  id: string;
  reference: string;
  transactionType: string;
  status: string;
  transactionDate: string;
  amount: string;
  currency: string;
  description: string | null;
  financialAccountName: string | null;
  ledgerAccountName: string | null;
  departmentName: string | null;
  paymentMethod: string | null;
  createdByName: string | null;
  reversesRef: string | null;
}

type PeriodKey =
  | "today"
  | "this_week"
  | "this_month"
  | "this_quarter"
  | "this_year"
  | "all";

// ---------------------------------------------------------------------------
// Period helper — returns {from,to} ISO date strings (from = start of period, to = end of today)
// ---------------------------------------------------------------------------
function periodRange(period: PeriodKey): { from?: string; to?: string } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (period) {
    case "today":
      return { from: startOfToday.toISOString(), to: endOfToday.toISOString() };
    case "this_week": {
      const day = startOfToday.getDay(); // 0 = Sunday
      const from = new Date(startOfToday);
      from.setDate(startOfToday.getDate() - day);
      return { from: from.toISOString(), to: endOfToday.toISOString() };
    }
    case "this_month":
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        to: endOfToday.toISOString(),
      };
    case "this_quarter": {
      const q = Math.floor(now.getMonth() / 3);
      return {
        from: new Date(now.getFullYear(), q * 3, 1).toISOString(),
        to: endOfToday.toISOString(),
      };
    }
    case "this_year":
      return {
        from: new Date(now.getFullYear(), 0, 1).toISOString(),
        to: endOfToday.toISOString(),
      };
    case "all":
    default:
      return {};
  }
}

const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: "Today",
  this_week: "This week",
  this_month: "This month",
  this_quarter: "This quarter",
  this_year: "This year",
  all: "All time",
};

const TYPE_BADGE: Record<string, string> = {
  income: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  expense: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  transfer: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  opening_balance: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  adjustment: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data?.error) return data.error as string;
  } catch {
    /* noop */
  }
  if (res.status === 401) return "You are not signed in.";
  if (res.status === 403) return "You are not authorized to view finance data.";
  return `Request failed (${res.status}).`;
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export function FinanceOverviewView() {
  const [period, setPeriod] = useState<PeriodKey>("this_month");
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [recent, setRecent] = useState<RecentTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const { from, to } = useMemo(() => periodRange(period), [period]);

  const refresh = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const qs = new URLSearchParams();
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
        const [sumRes, accRes, txRes] = await Promise.all([
          fetch(`/api/finance/reports/summary?${qs.toString()}`),
          fetch(`/api/finance/accounts?withBalances=true`),
          fetch(`/api/finance/transactions?pageSize=5`),
        ]);
        if (!sumRes.ok) throw new Error(await readError(sumRes));
        if (!accRes.ok) throw new Error(await readError(accRes));
        if (!txRes.ok) throw new Error(await readError(txRes));
        const [s, a, t] = await Promise.all([sumRes.json(), accRes.json(), txRes.json()]);
        if (cancelled) return;
        setSummary(s as SummaryResponse);
        setAccounts((a?.items ?? []) as AccountBalance[]);
        setRecent((t?.items ?? []) as RecentTransaction[]);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load finance overview.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  useEffect(() => refresh(), [refresh]);

  // Chart data: comparative income vs expense for the period (single-period snapshot).
  const chartData = useMemo(() => {
    if (!summary) return [];
    return [
      { label: "Income", value: Number(summary.totalIncome || 0), kind: "income" },
      { label: "Expenses", value: Number(summary.totalExpenses || 0), kind: "expense" },
      {
        label: "Net",
        value: Number(summary.netMovement || 0),
        kind: "net",
      },
    ];
  }, [summary]);

  const cashCurrency = accounts[0]?.currency ?? "GHS";
  const hasRecent = recent.length > 0;
  const showEmpty = !loading && (!summary || summary.transactionCount === 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance Overview"
        description="A snapshot of Lightworld's financial health for the selected period."
        action={
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
            <SelectTrigger className="w-[160px]" aria-label="Select period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="this_week">This week</SelectItem>
              <SelectItem value="this_month">This month</SelectItem>
              <SelectItem value="this_quarter">This quarter</SelectItem>
              <SelectItem value="this_year">This year</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total Income"
          value={summary ? formatMoney(summary.totalIncome, cashCurrency) : undefined}
          icon={TrendingUp}
          accent="success"
          loading={loading}
          hint={`Period: ${PERIOD_LABEL[period]}`}
        />
        <KpiCard
          label="Total Expenses"
          value={summary ? formatMoney(summary.totalExpenses, cashCurrency) : undefined}
          icon={TrendingDown}
          accent="danger"
          loading={loading}
          hint={`Period: ${PERIOD_LABEL[period]}`}
        />
        <KpiCard
          label="Net Movement"
          value={summary ? formatMoney(summary.netMovement, cashCurrency) : undefined}
          icon={Scale}
          accent={
            summary
              ? Number(summary.netMovement) >= 0
                ? "success"
                : "danger"
              : "default"
          }
          loading={loading}
          hint="Income − Expenses"
        />
        <KpiCard
          label="Cash Position"
          value={summary ? formatMoney(summary.cashPosition, cashCurrency) : undefined}
          icon={Wallet}
          loading={loading}
          hint="All-time · derived"
        />
      </div>

      {showEmpty ? (
        <EmptyState
          icon={Receipt}
          title="No financial transactions recorded for this period."
          description="Once income or expenses are posted, this overview will light up with KPIs, charts, and recent activity."
        />
      ) : (
        <>
          {/* Chart + account balances */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">Income vs Expenses</CardTitle>
                  <CardDescription className="text-xs">
                    Period comparison · {PERIOD_LABEL[period]}
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {summary?.transactionCount ?? 0} tx
                </Badge>
              </CardHeader>
              <CardContent className="pl-2">
                <div className="h-[260px] w-full">
                  {loading ? (
                    <Skeleton className="h-full w-full" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="ovGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="oklch(0.55 0.14 162)" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="oklch(0.55 0.14 162)" stopOpacity={0} />
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
                          width={70}
                          tickFormatter={(v) =>
                            new Intl.NumberFormat("en-US", { notation: "compact" }).format(Number(v))
                          }
                        />
                        <ReTooltip
                          contentStyle={{
                            borderRadius: 8,
                            border: "1px solid hsl(var(--border))",
                            fontSize: 12,
                          }}
                          formatter={(v: number) => formatMoney(v, cashCurrency)}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="oklch(0.55 0.14 162)"
                          strokeWidth={2}
                          fill="url(#ovGrad)"
                          name="Amount"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Account Balances</CardTitle>
                <CardDescription className="text-xs">Live · derived from posted entries</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="space-y-1.5">
                          <Skeleton className="h-3 w-24" />
                          <Skeleton className="h-2.5 w-16" />
                        </div>
                        <Skeleton className="h-4 w-20" />
                      </div>
                    ))
                  ) : accounts.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      No cash & bank accounts yet.
                    </div>
                  ) : (
                    accounts.slice(0, 6).map((a) => (
                      <div key={a.accountId} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {a.code}
                            </Badge>
                            <p className="truncate text-sm font-medium">{a.name}</p>
                          </div>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {a.accountType} · {a.transactionCount} tx
                          </p>
                        </div>
                        <p
                          className={cn(
                            "shrink-0 text-sm font-semibold tabular-nums",
                            Number(a.balance) < 0 ? "text-rose-600" : "text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          {formatMoney(a.balance, a.currency)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent transactions + category breakdowns */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">Recent Transactions</CardTitle>
                  <CardDescription className="text-xs">Last 5 entries</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="space-y-1.5">
                          <Skeleton className="h-3 w-32" />
                          <Skeleton className="h-2.5 w-24" />
                        </div>
                        <Skeleton className="h-4 w-20" />
                      </div>
                    ))
                  ) : !hasRecent ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      No transactions yet.
                    </div>
                  ) : (
                    recent.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] capitalize",
                                TYPE_BADGE[tx.transactionType] ?? "border-zinc-400/30 bg-zinc-400/10 text-zinc-600",
                              )}
                            >
                              {tx.transactionType.replace("_", " ")}
                            </Badge>
                            <span className="truncate text-sm font-medium">
                              {tx.description ?? tx.reference}
                            </span>
                          </div>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {tx.reference} · {formatDateTime(tx.transactionDate)} · {tx.createdByName ?? "—"}
                          </p>
                        </div>
                        <p
                          className={cn(
                            "shrink-0 text-sm font-semibold tabular-nums",
                            tx.transactionType === "income" && "text-emerald-600 dark:text-emerald-400",
                            tx.transactionType === "expense" && "text-rose-600 dark:text-rose-400",
                            tx.transactionType === "transfer" && "text-sky-600 dark:text-sky-400",
                          )}
                        >
                          {tx.transactionType === "expense" ? "−" : tx.transactionType === "income" ? "+" : ""}
                          {formatMoney(tx.amount, tx.currency)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <CategoryBreakdownCard
                title="Income by Category"
                icon={PiggyBank}
                loading={loading}
                items={summary?.incomeByType ?? []}
                currency={cashCurrency}
                accent="emerald"
              />
              <CategoryBreakdownCard
                title="Expense by Category"
                icon={Activity}
                loading={loading}
                items={summary?.expenseByType ?? []}
                currency={cashCurrency}
                accent="rose"
              />
            </div>
          </div>
        </>
      )}

      <p className="pt-2 text-center text-[11px] text-muted-foreground">
        All figures derive from posted journal entries. Draft, voided, and reversed-original entries are excluded.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category breakdown card (used twice)
// ---------------------------------------------------------------------------
function CategoryBreakdownCard({
  title,
  icon: Icon,
  loading,
  items,
  currency,
  accent,
}: {
  title: string;
  icon: typeof Activity;
  loading: boolean;
  items: { type: string; total: string; count: number }[];
  currency: string;
  accent: "emerald" | "rose";
}) {
  const accentText =
    accent === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400";
  const accentIcon =
    accent === "emerald"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : "bg-rose-500/10 text-rose-600 dark:text-rose-400";
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">{title}</CardTitle>
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-md", accentIcon)}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">No data for this period.</div>
        ) : (
          <div className="divide-y">
            {items.slice(0, 6).map((c) => (
              <div key={c.type} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.type}</p>
                  <p className="text-[11px] text-muted-foreground">{c.count} tx</p>
                </div>
                <p className={cn("shrink-0 text-sm font-semibold tabular-nums", accentText)}>
                  {formatMoney(c.total, currency)}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
