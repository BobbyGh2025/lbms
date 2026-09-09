"use client";

// ============================================================================
// LBMS Finance Reports View
// ----------------------------------------------------------------------------
// Three report cards: Summary, Account Activity, Reconciliation. Period filter
// with custom range, plus a CSV export on the summary report.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BarChart3,
  FileText,
  Wallet,
  CheckCircle2,
  AlertTriangle,
  Download,
  RefreshCw,
  Loader2,
  TrendingUp,
  TrendingDown,
  Scale,
} from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { KpiCard } from "@/components/common/kpi-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { formatMoney } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
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
  currency: string;
  accountType: string;
  openingBalance: string;
  postedDebits: string;
  postedCredits: string;
  balance: string;
  transactionCount: number;
}

interface AccountActivityResponse {
  account: AccountBalance;
  transactions: Array<{
    reference: string;
    transactionType: string;
    transactionDate: string;
    description: string;
    debit: string;
    credit: string;
    status: string;
  }>;
}

interface ReconciliationIssue {
  journalId: string;
  reference: string;
  debitTotal: string;
  creditTotal: string;
}

interface ReconciliationResponse {
  balanced: boolean;
  totalJournals: number;
  unbalancedJournals: number;
  issues: ReconciliationIssue[];
}

type PeriodKey =
  | "today"
  | "this_week"
  | "this_month"
  | "this_quarter"
  | "this_year"
  | "all"
  | "custom";

// ---------------------------------------------------------------------------
// Period helper
// ---------------------------------------------------------------------------
function periodRange(period: PeriodKey, customFrom?: string, customTo?: string) {
  if (period === "custom") {
    return {
      from: customFrom ? new Date(customFrom).toISOString() : undefined,
      to: customTo ? new Date(`${customTo}T23:59:59`).toISOString() : undefined,
    };
  }
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  switch (period) {
    case "today":
      return { from: startOfToday.toISOString(), to: endOfToday.toISOString() };
    case "this_week": {
      const from = new Date(startOfToday);
      from.setDate(startOfToday.getDate() - startOfToday.getDay());
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
  custom: "Custom range",
};

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data?.error) return data.error as string;
  } catch {
    /* noop */
  }
  if (res.status === 401) return "You are not signed in.";
  if (res.status === 403) return "You are not authorized to view finance reports.";
  return `Request failed (${res.status}).`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function escapeCSV(value: string): string {
  const s = value ?? "";
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export function FinanceReportsView() {
  const { can } = useAuth();
  const canViewReports = can("finance", "view_reports");

  const [period, setPeriod] = useState<PeriodKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const { from, to } = useMemo(
    () => periodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  const [tab, setTab] = useState("summary");

  if (!canViewReports) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Finance Reports"
          description="Summary, account activity, and reconciliation reports."
        />
        <EmptyState
          icon={BarChart3}
          title="Reports require the finance:view_reports permission"
          description="Ask an administrator to grant your role the finance:view_reports permission."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Finance Reports"
        description="Summary, account activity, and reconciliation reports derived from posted journals."
      />

      {/* Period filter */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="rp-period" className="text-[11px] text-muted-foreground">
              Period
            </Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
              <SelectTrigger id="rp-period" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="this_week">This week</SelectItem>
                <SelectItem value="this_month">This month</SelectItem>
                <SelectItem value="this_quarter">This quarter</SelectItem>
                <SelectItem value="this_year">This year</SelectItem>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="custom">Custom range…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {period === "custom" && (
            <>
              <div className="space-y-1">
                <Label htmlFor="rp-from" className="text-[11px] text-muted-foreground">
                  From
                </Label>
                <Input
                  id="rp-from"
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-[150px]"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rp-to" className="text-[11px] text-muted-foreground">
                  To
                </Label>
                <Input
                  id="rp-to"
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-[150px]"
                />
              </div>
            </>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex w-full flex-wrap sm:w-auto">
          <TabsTrigger value="summary" className="flex-1 sm:flex-none">
            <FileText className="h-3.5 w-3.5" />
            Summary
          </TabsTrigger>
          <TabsTrigger value="account" className="flex-1 sm:flex-none">
            <Wallet className="h-3.5 w-3.5" />
            Account Activity
          </TabsTrigger>
          <TabsTrigger value="reconciliation" className="flex-1 sm:flex-none">
            <Scale className="h-3.5 w-3.5" />
            Reconciliation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          <SummaryReport from={from} to={to} period={period} />
        </TabsContent>
        <TabsContent value="account" className="mt-4">
          <AccountActivityReport from={from} to={to} />
        </TabsContent>
        <TabsContent value="reconciliation" className="mt-4">
          <ReconciliationReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary Report
// ---------------------------------------------------------------------------
function SummaryReport({
  from,
  to,
  period,
}: {
  from?: string;
  to?: string;
  period: PeriodKey;
}) {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
        const res = await fetch(`/api/finance/reports/summary?${qs.toString()}`);
        if (!res.ok) throw new Error(await readError(res));
        const json: SummaryResponse = await res.json();
        if (!cancelled) setSummary(json);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load summary report.");
          setSummary(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, refreshKey]);

  const currency = "GHS";

  function exportCSV() {
    if (!summary) return;
    const rows: string[][] = [];
    rows.push(["Section", "Field", "Value"]);
    rows.push(["Period", "From", formatDate(summary.period.from)]);
    rows.push(["Period", "To", formatDate(summary.period.to)]);
    rows.push(["Totals", "Total Income", summary.totalIncome]);
    rows.push(["Totals", "Total Expenses", summary.totalExpenses]);
    rows.push(["Totals", "Net Movement", summary.netMovement]);
    rows.push(["Totals", "Cash Position", summary.cashPosition]);
    rows.push(["Totals", "Transaction Count", String(summary.transactionCount)]);
    rows.push([]);
    rows.push(["Income by Category", "Count", "Total"]);
    for (const c of summary.incomeByType) {
      rows.push([c.type, String(c.count), c.total]);
    }
    rows.push([]);
    rows.push(["Expense by Category", "Count", "Total"]);
    for (const c of summary.expenseByType) {
      rows.push([c.type, String(c.count), c.total]);
    }
    const csv = rows.map((r) => r.map(escapeCSV).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateLabel =
      summary.period.from && summary.period.to
        ? `${summary.period.from.slice(0, 10)}_to_${summary.period.to.slice(0, 10)}`
        : "all-time";
    a.download = `lbms-finance-summary-${dateLabel}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Summary exported as CSV.");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={exportCSV}
          disabled={loading || !summary}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total Income"
          value={summary ? formatMoney(summary.totalIncome, currency) : undefined}
          icon={TrendingUp}
          accent="success"
          loading={loading}
          hint={`Period: ${PERIOD_LABEL[period]}`}
        />
        <KpiCard
          label="Total Expenses"
          value={summary ? formatMoney(summary.totalExpenses, currency) : undefined}
          icon={TrendingDown}
          accent="danger"
          loading={loading}
          hint={`Period: ${PERIOD_LABEL[period]}`}
        />
        <KpiCard
          label="Net Movement"
          value={summary ? formatMoney(summary.netMovement, currency) : undefined}
          icon={Scale}
          accent={
            summary ? (Number(summary.netMovement) >= 0 ? "success" : "danger") : "default"
          }
          loading={loading}
          hint="Income − Expenses"
        />
        <KpiCard
          label="Transaction Count"
          value={summary?.transactionCount}
          icon={FileText}
          loading={loading}
          hint={`Period: ${PERIOD_LABEL[period]}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cash Position</CardTitle>
          <CardDescription className="text-xs">
            Derived from all posted journal entries across all cash & bank accounts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {summary ? formatMoney(summary.cashPosition, currency) : "—"}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <CategoryListCard
          title="Income by Category"
          loading={loading}
          items={summary?.incomeByType ?? []}
          currency={currency}
          accent="emerald"
        />
        <CategoryListCard
          title="Expense by Category"
          loading={loading}
          items={summary?.expenseByType ?? []}
          currency={currency}
          accent="rose"
        />
      </div>
    </div>
  );
}

function CategoryListCard({
  title,
  loading,
  items,
  currency,
  accent,
}: {
  title: string;
  loading: boolean;
  items: { type: string; total: string; count: number }[];
  currency: string;
  accent: "emerald" | "rose";
}) {
  const accentText =
    accent === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            No data for the selected period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="h-8 text-[11px]">Category</TableHead>
                  <TableHead className="h-8 text-right text-[11px]">Count</TableHead>
                  <TableHead className="h-8 text-right text-[11px]">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={`${c.type}-${c.count}`}>
                    <TableCell className="py-2 text-sm">{c.type}</TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-xs">
                      {c.count}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "py-2 text-right text-sm font-semibold tabular-nums",
                        accentText,
                      )}
                    >
                      {formatMoney(c.total, currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Account Activity Report
// ---------------------------------------------------------------------------
function AccountActivityReport({ from, to }: { from?: string; to?: string }) {
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [activity, setActivity] = useState<AccountActivityResponse | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(false);

  // Fetch accounts list for the dropdown
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/finance/accounts?withBalances=true");
        if (!res.ok) throw new Error(await readError(res));
        const json = await res.json();
        if (cancelled) return;
        setAccounts(json.items ?? []);
        if (json.items?.length > 0 && !selectedId) {
          setSelectedId(json.items[0].accountId);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load accounts.");
        }
      } finally {
        if (!cancelled) setLoadingAccounts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch account activity when selection or range changes
  useEffect(() => {
    if (!selectedId) {
      setActivity(null);
      return;
    }
    let cancelled = false;
    setLoadingActivity(true);
    (async () => {
      try {
        const qs = new URLSearchParams({ accountId: selectedId });
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
        const res = await fetch(`/api/finance/reports/account?${qs.toString()}`);
        if (!res.ok) throw new Error(await readError(res));
        const json: AccountActivityResponse = await res.json();
        if (!cancelled) setActivity(json);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load account activity.");
          setActivity(null);
        }
      } finally {
        if (!cancelled) setLoadingActivity(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, from, to]);

  const currency = activity?.account.currency ?? "GHS";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account Activity</CardTitle>
          <CardDescription className="text-xs">
            Select an account to view its opening balance, posted transactions, and current balance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingAccounts ? (
            <Skeleton className="h-9 w-full max-w-sm" />
          ) : (
            <div className="max-w-md">
              <Label htmlFor="acct-pick" className="sr-only">
                Pick an account
              </Label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger id="acct-pick" className="w-full">
                  <SelectValue placeholder="Select account…" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      No accounts available
                    </SelectItem>
                  ) : (
                    accounts.map((a) => (
                      <SelectItem key={a.accountId} value={a.accountId}>
                        {a.code} · {a.name} ({a.currency})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {!selectedId && !loadingAccounts ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Pick an account to view its activity.
            </p>
          ) : loadingActivity ? (
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : activity ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <BalancePill
                  label="Opening"
                  value={formatMoney(activity.account.openingBalance, currency)}
                />
                <BalancePill
                  label="Net Movement"
                  value={formatMoney(
                    String(
                      Number(activity.account.postedDebits) -
                        Number(activity.account.postedCredits),
                    ),
                    currency,
                  )}
                  tone={
                    Number(activity.account.postedDebits) -
                      Number(activity.account.postedCredits) >=
                    0
                      ? "emerald"
                      : "rose"
                  }
                />
                <BalancePill
                  label="Current Balance"
                  value={formatMoney(activity.account.balance, currency)}
                  tone={Number(activity.account.balance) >= 0 ? "emerald" : "rose"}
                  bold
                />
              </div>

              <div className="rounded-md border">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="h-8 text-[11px]">Reference</TableHead>
                        <TableHead className="h-8 text-[11px]">Date</TableHead>
                        <TableHead className="h-8 text-[11px]">Description</TableHead>
                        <TableHead className="h-8 text-right text-[11px]">Debit</TableHead>
                        <TableHead className="h-8 text-right text-[11px]">Credit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activity.transactions.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                            No transactions in the selected period.
                          </TableCell>
                        </TableRow>
                      ) : (
                        activity.transactions.map((t, i) => (
                          <TableRow key={`${t.reference}-${i}`}>
                            <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                            <TableCell className="text-xs">{formatDate(t.transactionDate)}</TableCell>
                            <TableCell className="max-w-[220px] truncate text-xs">
                              {t.description ?? "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs text-emerald-600 dark:text-emerald-400">
                              {Number(t.debit) > 0 ? formatMoney(t.debit, currency) : "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs text-rose-600 dark:text-rose-400">
                              {Number(t.credit) > 0 ? formatMoney(t.credit, currency) : "—"}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Showing {activity.transactions.length} entr
                {activity.transactions.length === 1 ? "y" : "ies"} · {activity.account.transactionCount}{" "}
                total posted entries on this account.
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function BalancePill({
  label,
  value,
  tone,
  bold,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "rose";
  bold?: boolean;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg tabular-nums",
          bold ? "font-bold" : "font-semibold",
          tone === "emerald" && "text-emerald-600 dark:text-emerald-400",
          tone === "rose" && "text-rose-600 dark:text-rose-400",
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reconciliation Report
// ---------------------------------------------------------------------------
function ReconciliationReport() {
  const [report, setReport] = useState<ReconciliationResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function runCheck() {
    setLoading(true);
    try {
      const res = await fetch("/api/finance/reconciliation");
      if (!res.ok) throw new Error(await readError(res));
      const json: ReconciliationResponse = await res.json();
      setReport(json);
      if (json.balanced) toast.success("All journals balance ✓");
      else toast.error(`${json.unbalancedJournals} unbalanced journal(s) found.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run reconciliation.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Reconciliation Check</CardTitle>
            <CardDescription className="text-xs">
              Verify every posted journal entry balances internally (debits = credits).
            </CardDescription>
          </div>
          <Button onClick={runCheck} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run Reconciliation
          </Button>
        </CardHeader>
        <CardContent>
          {!report ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Click <span className="font-medium">Run Reconciliation</span> to verify ledger integrity.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Status banner */}
              <div
                className={cn(
                  "flex items-center gap-3 rounded-md border p-4",
                  report.balanced
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-rose-500/40 bg-rose-500/10",
                )}
              >
                {report.balanced ? (
                  <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-8 w-8 shrink-0 text-rose-600 dark:text-rose-400" />
                )}
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      report.balanced
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-rose-700 dark:text-rose-300",
                    )}
                  >
                    {report.balanced
                      ? "Ledger is balanced"
                      : `${report.unbalancedJournals} unbalanced journal${report.unbalancedJournals === 1 ? "" : "s"} found`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Scanned {report.totalJournals} posted journal
                    {report.totalJournals === 1 ? "" : "s"}.
                  </p>
                </div>
              </div>

              {/* Issues table */}
              {report.issues.length > 0 && (
                <div className="rounded-md border">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40">
                          <TableHead className="h-8 text-[11px]">Reference</TableHead>
                          <TableHead className="h-8 text-right text-[11px]">Debit Total</TableHead>
                          <TableHead className="h-8 text-right text-[11px]">Credit Total</TableHead>
                          <TableHead className="h-8 text-right text-[11px]">Variance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.issues.map((iss) => {
                          const variance =
                            Number(iss.debitTotal) - Number(iss.creditTotal);
                          return (
                            <TableRow key={iss.journalId}>
                              <TableCell className="font-mono text-xs">{iss.reference}</TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-emerald-600 dark:text-emerald-400">
                                {formatMoney(iss.debitTotal, "GHS")}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-rose-600 dark:text-rose-400">
                                {formatMoney(iss.creditTotal, "GHS")}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs font-semibold text-rose-600 dark:text-rose-400">
                                {variance > 0 ? "+" : ""}
                                {formatMoney(variance, "GHS")}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                Reconciliation runs on posted journals only. Draft, voided, and reversed originals are excluded.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">How reconciliation works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>
            Every posted journal must satisfy the fundamental double-entry rule:
            <span className="font-mono"> Σ(debits) = Σ(credits)</span>. This check scans all
            posted journals and verifies the rule holds for each.
          </p>
          <p>
            A balanced ledger means the posting engine is operating correctly. If any journal is
            unbalanced, it indicates a bug in the engine and must be investigated immediately.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <Badge variant="outline" className="text-[10px]">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Green = balanced
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              <AlertTriangle className="h-3 w-3 text-rose-600" /> Red = unbalanced
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
