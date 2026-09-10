"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Wallet, AlertTriangle, Receipt, Clock, RefreshCw, Loader2, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/finance/money";

// ---------------------------------------------------------------------------
// Types — matches the actual API response from /api/sales/receivables
// ---------------------------------------------------------------------------

interface AgingBucket {
  count: number;
  amount: string;
}

interface ReceivablesSummary {
  totalOutstanding: string;
  totalOverdue: string;
  outstandingCount: number;
  overdueCount: number;
  invoiceCount: number;
}

interface CustomerBreakdownRow {
  customerId: string;
  customerNumber: string;
  name: string;
  status?: string | null;
  outstanding: string;
  overdue: string;
  invoiceCount: number;
  overdueCount: number;
  oldestDueDate: string | null;
}

interface ReceivablesData {
  summary: ReceivablesSummary;
  aging: {
    "0-30": AgingBucket;
    "31-60": AgingBucket;
    "61-90": AgingBucket;
    "90+": AgingBucket;
  };
  customerBreakdown: CustomerBreakdownRow[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function money(v: string | null | undefined): string {
  if (!v) return "GHS 0.00";
  return formatMoney(v, "GHS");
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short", day: "2-digit", year: "numeric",
    });
  } catch { return "—"; }
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

interface AgingBar {
  label: string;
  bucket: AgingBucket;
  accent: string;
}

const AGING_ACCENTS: Record<string, string> = {
  current: "bg-emerald-500",
  "1-30": "bg-amber-500",
  "31-60": "bg-orange-500",
  "61-90": "bg-rose-500",
  "90+": "bg-rose-700",
};

const AGING_BADGE: Record<string, string> = {
  current: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "1-30": "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "31-60": "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  "61-90": "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  "90+": "bg-rose-700/10 text-rose-700 dark:text-rose-300",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReceivablesView() {
  const { can } = useAuth();
  const [data, setData] = useState<ReceivablesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchReceivables = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/sales/receivables");
      if (!res.ok) {
        if (!silent) toast.error("Failed to load receivables.");
        return;
      }
      const json = await res.json();
      setData(json);
    } catch {
      if (!silent) toast.error("Failed to load receivables.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchReceivables();
  }, [fetchReceivables]);

  if (!can("sales", "view")) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Receivables"
          description="Outstanding customer balances and aging."
        />
        <EmptyState
          icon={Wallet}
          title="No access"
          description="You do not have permission to view receivables."
        />
      </div>
    );
  }

  // Build aging bars
  const agingBars: AgingBar[] = data ? [
    { label: "Current (not overdue)", bucket: { count: 0, amount: "0" }, accent: "bg-emerald-500" },
    { label: "1–30 days", bucket: data.aging["0-30"], accent: AGING_ACCENTS["1-30"] },
    { label: "31–60 days", bucket: data.aging["31-60"], accent: AGING_ACCENTS["31-60"] },
    { label: "61–90 days", bucket: data.aging["61-90"], accent: AGING_ACCENTS["61-90"] },
    { label: "90+ days", bucket: data.aging["90+"], accent: AGING_ACCENTS["90+"] },
  ] : [];

  const totalAgingAmount = agingBars.slice(1).reduce(
    (acc, b) => acc + Number(b.bucket.amount || 0), 0,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Receivables"
        description="Outstanding customer balances and aging."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchReceivables(true)}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        }
      />

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-muted-foreground">Total Outstanding</p>
              {loading ? (
                <Skeleton className="mt-2 h-7 w-32" />
              ) : (
                <p className="mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">
                  {money(data?.summary.totalOutstanding)}
                </p>
              )}
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                Across {data?.summary.outstandingCount ?? 0} open invoice(s)
              </p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <Wallet className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-muted-foreground">Overdue</p>
              {loading ? (
                <Skeleton className="mt-2 h-7 w-32" />
              ) : (
                <p className="mt-1 truncate text-xl font-bold tracking-tight text-rose-600 sm:text-2xl">
                  {money(data?.summary.totalOverdue)}
                </p>
              )}
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                {data?.summary.overdueCount ?? 0} overdue invoice(s)
              </p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-muted-foreground">Outstanding Invoices</p>
              {loading ? (
                <Skeleton className="mt-2 h-7 w-24" />
              ) : (
                <p className="mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">
                  {data?.summary.outstandingCount ?? 0}
                </p>
              )}
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                With unpaid balance
              </p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Receipt className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-muted-foreground">Overdue Invoices</p>
              {loading ? (
                <Skeleton className="mt-2 h-7 w-24" />
              ) : (
                <p className="mt-1 truncate text-xl font-bold tracking-tight text-rose-600 sm:text-2xl">
                  {data?.summary.overdueCount ?? 0}
                </p>
              )}
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                Past due date
              </p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <Clock className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Aging buckets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" /> Aging Buckets
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : totalAgingAmount === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No overdue balances"
              description="All outstanding invoices are within their due dates."
            />
          ) : (
            <div className="space-y-3">
              {agingBars.slice(1).map((b) => {
                const amount = Number(b.bucket.amount || 0);
                const pct = totalAgingAmount > 0 ? Math.round((amount / totalAgingAmount) * 100) : 0;
                return (
                  <div key={b.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={AGING_BADGE[b.label === "1–30 days" ? "1-30" : b.label === "31–60 days" ? "31-60" : b.label === "61–90 days" ? "61-90" : "90+"]}>
                          {b.label}
                        </Badge>
                        <span className="text-muted-foreground">{b.bucket.count} invoice(s)</span>
                      </div>
                      <span className="font-semibold">{money(b.bucket.amount)} · {pct}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${b.accent}`}
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {data && (
            <p className="text-xs text-muted-foreground pt-2 border-t">
              Snapshot generated {fmtDateTime(data.generatedAt)}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Customer breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Customer Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !data || data.customerBreakdown.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Wallet}
                title="No outstanding customer balances"
                description="All customer invoices are fully paid."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-right">Overdue</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead>Oldest Due</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.customerBreakdown.map((c) => {
                    const overdueNum = Number(c.overdue || 0);
                    return (
                      <TableRow key={c.customerId}>
                        <TableCell>
                          <div className="text-sm font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{c.customerNumber}</div>
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold">
                          {money(c.outstanding)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {overdueNum > 0 ? (
                            <span className="text-rose-600 font-medium">{money(c.overdue)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          <span>{c.invoiceCount}</span>
                          {c.overdueCount > 0 && (
                            <span className="text-rose-600 ml-1">({c.overdueCount} overdue)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {c.oldestDueDate ? (
                            <span className={overdueNum > 0 ? "text-rose-600 font-medium" : ""}>
                              {fmt(c.oldestDueDate)}
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
