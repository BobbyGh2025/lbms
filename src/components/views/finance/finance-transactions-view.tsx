"use client";

// ============================================================================
// LBMS Finance Transactions View — the unified ledger
// ----------------------------------------------------------------------------
// The most important finance view. Server-side paginated list with
// comprehensive filters, a color-coded data table, row-click detail dialog
// showing the journal entries, and a reverse action (with reason) gated on
// `finance:reverse`.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Receipt,
  Search,
  Eye,
  Undo2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Filter,
} from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { formatMoney } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types (mirror API contracts)
// ---------------------------------------------------------------------------
interface AccountOption {
  id: string;
  code: string;
  name: string;
  currency: string;
}

interface CategoryOption {
  id: string;
  code: string;
  name: string;
  accountClass: string;
}

interface DepartmentOption {
  id: string;
  name: string;
  code: string | null;
}

interface TransactionListItem {
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

interface TransactionListResponse {
  items: TransactionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface TransactionDetailEntry {
  id: string;
  financialAccountCode: string;
  financialAccountName: string;
  ledgerAccountCode: string | null;
  ledgerAccountName: string | null;
  debit: string;
  credit: string;
  description: string | null;
}

interface TransactionDetail {
  id: string;
  reference: string;
  transactionType: string;
  status: string;
  transactionDate: string;
  amount: string;
  currency: string;
  description: string | null;
  notes: string | null;
  paymentMethod: string | null;
  externalRef: string | null;
  reversalReason: string | null;
  createdAt: string;
  postedAt: string | null;
  financialAccount: { id: string; name: string; code: string } | null;
  ledgerAccount: { id: string; name: string; code: string } | null;
  department: { id: string; name: string } | null;
  createdBy: { id: string; username: string; email: string } | null;
  reverses: { id: string; reference: string } | null;
  reversedBy: { id: string; reference: string } | null;
  entries: TransactionDetailEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PAGE_SIZE = 15;

const TYPE_BADGE: Record<string, string> = {
  income: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  expense: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  transfer: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  opening_balance: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  adjustment: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
};

const STATUS_BADGE: Record<string, string> = {
  posted: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  draft: "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
  voided: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  reversed: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

const AMOUNT_COLOR: Record<string, string> = {
  income: "text-emerald-600 dark:text-emerald-400",
  expense: "text-rose-600 dark:text-rose-400",
  transfer: "text-sky-600 dark:text-sky-400",
  opening_balance: "text-amber-600 dark:text-amber-400",
  adjustment: "text-violet-600 dark:text-violet-400",
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  mobile_money: "Mobile money",
  card: "Card",
  cheque: "Cheque",
  other: "Other",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
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
  if (res.status === 403) return "You are not authorized to perform this action.";
  return `Request failed (${res.status}).`;
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export function FinanceTransactionsView() {
  const { can } = useAuth();
  const canReverse = can("finance", "reverse");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [transactionType, setTransactionType] = useState("all");
  const [status, setStatus] = useState("all");
  const [accountId, setAccountId] = useState("all");
  const [categoryId, setCategoryId] = useState("all");
  const [departmentId, setDepartmentId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const [filtersOpen, setFiltersOpen] = useState(false);

  const [data, setData] = useState<TransactionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [detail, setDetail] = useState<TransactionListItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<TransactionListItem | null>(null);

  // Filter option lists
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch filter options once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [a, c, d] = await Promise.all([
          fetch("/api/finance/accounts"),
          fetch("/api/finance/categories"),
          fetch("/api/departments"),
        ]);
        const [aj, cj, dj] = await Promise.all([
          a.ok ? a.json() : { items: [] },
          c.ok ? c.json() : { items: [] },
          d.ok ? d.json() : { items: [] },
        ]);
        if (cancelled) return;
        setAccounts(aj.items ?? []);
        setCategories(cj.items ?? []);
        setDepartments(dj.items ?? []);
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch transactions list
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        });
        if (debouncedSearch) qs.set("search", debouncedSearch);
        if (transactionType !== "all") qs.set("transactionType", transactionType);
        if (status !== "all") qs.set("status", status);
        if (accountId !== "all") qs.set("financialAccountId", accountId);
        if (categoryId !== "all") qs.set("ledgerAccountId", categoryId);
        if (departmentId !== "all") qs.set("departmentId", departmentId);
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
        const res = await fetch(`/api/finance/transactions?${qs.toString()}`);
        if (!res.ok) throw new Error(await readError(res));
        const json: TransactionListResponse = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load transactions.");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    debouncedSearch,
    transactionType,
    status,
    accountId,
    categoryId,
    departmentId,
    from,
    to,
    page,
    refreshKey,
  ]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const showEmpty = !loading && (!data || data.items.length === 0);
  const hasActiveFilters =
    !!debouncedSearch ||
    transactionType !== "all" ||
    status !== "all" ||
    accountId !== "all" ||
    categoryId !== "all" ||
    departmentId !== "all" ||
    !!from ||
    !!to;

  function clearFilters() {
    setSearch("");
    setTransactionType("all");
    setStatus("all");
    setAccountId("all");
    setCategoryId("all");
    setDepartmentId("all");
    setFrom("");
    setTo("");
    setPage(1);
  }

  function openDetail(tx: TransactionListItem) {
    setDetail(tx);
    setDetailOpen(true);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transactions"
        description="The unified ledger — every journal entry across income, expenses, transfers, openings, and adjustments."
      />

      {/* Primary filter row */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="relative w-full lg:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reference, description, external ref…"
            aria-label="Search transactions"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="tx-type" className="text-[11px] text-muted-foreground">
              Type
            </Label>
            <Select value={transactionType} onValueChange={(v) => { setTransactionType(v); setPage(1); }}>
              <SelectTrigger id="tx-type" className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
                <SelectItem value="opening_balance">Opening balance</SelectItem>
                <SelectItem value="adjustment">Adjustment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tx-status" className="text-[11px] text-muted-foreground">
              Status
            </Label>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger id="tx-status" className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="posted">Posted</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="voided">Voided</SelectItem>
                <SelectItem value="reversed">Reversed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant={filtersOpen ? "default" : "outline"}
            size="sm"
            onClick={() => setFiltersOpen((v) => !v)}
            className="h-9"
          >
            <Filter className="h-4 w-4" />
            More filters
          </Button>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9">
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Secondary (collapsible) filters */}
      {filtersOpen && (
        <div className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="space-y-1">
            <Label htmlFor="tx-account" className="text-[11px] text-muted-foreground">
              Account
            </Label>
            <Select value={accountId} onValueChange={(v) => { setAccountId(v); setPage(1); }}>
              <SelectTrigger id="tx-account" className="w-full">
                <SelectValue placeholder="All accounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tx-cat" className="text-[11px] text-muted-foreground">
              Category
            </Label>
            <Select value={categoryId} onValueChange={(v) => { setCategoryId(v); setPage(1); }}>
              <SelectTrigger id="tx-cat" className="w-full">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tx-dept" className="text-[11px] text-muted-foreground">
              Department
            </Label>
            <Select value={departmentId} onValueChange={(v) => { setDepartmentId(v); setPage(1); }}>
              <SelectTrigger id="tx-dept" className="w-full">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tx-from" className="text-[11px] text-muted-foreground">
              From
            </Label>
            <Input
              id="tx-from"
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tx-to" className="text-[11px] text-muted-foreground">
              To
            </Label>
            <Input
              id="tx-to"
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); setPage(1); }}
            />
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <TransactionsTableSkeleton />
      ) : showEmpty ? (
        <EmptyState
          icon={Receipt}
          title="No transactions found"
          description={
            hasActiveFilters
              ? "Try adjusting your filters or date range."
              : "Record income, expenses, or transfers to populate the ledger."
          }
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Reference</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="w-[80px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((tx) => {
                  const isReversible = tx.status === "posted" && canReverse;
                  return (
                    <TableRow
                      key={tx.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => openDetail(tx)}
                    >
                      <TableCell className="font-mono text-xs">
                        <div className="flex items-center gap-1">
                          {tx.reference}
                          {tx.reversesRef && (
                            <Badge
                              variant="outline"
                              className="border-amber-500/30 bg-amber-500/10 text-amber-700 text-[9px] dark:text-amber-300"
                            >
                              ↺
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] capitalize",
                            TYPE_BADGE[tx.transactionType] ??
                              "border-zinc-400/30 bg-zinc-400/10 text-zinc-600",
                          )}
                        >
                          {tx.transactionType.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] capitalize",
                            STATUS_BADGE[tx.status] ??
                              "border-zinc-400/30 bg-zinc-400/10 text-zinc-600",
                          )}
                        >
                          {tx.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{formatDate(tx.transactionDate)}</TableCell>
                      <TableCell className="max-w-[220px]">
                        <p className="truncate text-sm font-medium">
                          {tx.description ?? "—"}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs">
                        {tx.financialAccountName ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {tx.ledgerAccountName ?? "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right text-sm font-semibold tabular-nums",
                          AMOUNT_COLOR[tx.transactionType] ?? "",
                        )}
                      >
                        {tx.transactionType === "expense" ? "−" : tx.transactionType === "income" ? "+" : ""}
                        {formatMoney(tx.amount, tx.currency)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {tx.createdByName ?? "—"}
                      </TableCell>
                      <TableCell
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="View transaction detail"
                            onClick={() => openDetail(tx)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {isReversible && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-amber-600 hover:text-amber-700"
                              aria-label="Reverse transaction"
                              onClick={() => setReverseTarget(tx)}
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {data && data.items.length > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            Showing{" "}
            <span className="font-medium text-foreground">
              {(data.page - 1) * data.pageSize + 1}
            </span>
            –
            <span className="font-medium text-foreground">
              {Math.min(data.page * data.pageSize, data.total)}
            </span>{" "}
            of <span className="font-medium text-foreground">{data.total}</span>{" "}
            transactions
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {data.page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail dialog */}
      <TransactionDetailDialog
        transaction={detail}
        open={detailOpen}
        onOpenChange={(o) => {
          setDetailOpen(o);
          if (!o) setDetail(null);
        }}
        canReverse={canReverse}
        onReverse={(tx) => {
          setDetailOpen(false);
          setReverseTarget(tx);
        }}
      />

      {/* Reverse dialog */}
      <ReverseTransactionDialog
        transaction={reverseTarget}
        onOpenChange={(o) => {
          if (!o) setReverseTarget(null);
        }}
        onReversed={() => {
          refresh();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function TransactionsTableSkeleton() {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead>Reference</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>By</TableHead>
            <TableHead className="w-[80px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: 10 }).map((__, j) => (
                <TableCell key={j}>
                  <Skeleton className="h-3 w-full max-w-[100px]" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail Dialog
// ---------------------------------------------------------------------------
interface DetailDialogProps {
  transaction: TransactionListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canReverse: boolean;
  onReverse: (tx: TransactionListItem) => void;
}

function TransactionDetailDialog({
  transaction,
  open,
  onOpenChange,
  canReverse,
  onReverse,
}: DetailDialogProps) {
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !transaction) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/finance/transactions/${transaction.id}`);
        if (!res.ok) throw new Error(await readError(res));
        const json: TransactionDetail = await res.json();
        if (!cancelled) setDetail(json);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load transaction detail.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, transaction]);

  if (!transaction) return null;

  const currency = transaction.currency;
  const isReversible = transaction.status === "posted" && canReverse;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-base">{transaction.reference}</span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] capitalize",
                TYPE_BADGE[transaction.transactionType] ??
                  "border-zinc-400/30 bg-zinc-400/10 text-zinc-600",
              )}
            >
              {transaction.transactionType.replace("_", " ")}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] capitalize",
                STATUS_BADGE[transaction.status] ??
                  "border-zinc-400/30 bg-zinc-400/10 text-zinc-600",
              )}
            >
              {transaction.status}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {transaction.description ?? "No description provided."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : detail ? (
          <div className="space-y-4">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <DetailField label="Date" value={formatDate(detail.transactionDate)} />
              <DetailField label="Amount" value={formatMoney(detail.amount, detail.currency)} mono />
              <DetailField label="Currency" value={detail.currency} />
              <DetailField label="Account" value={detail.financialAccount?.name ?? "—"} sub={detail.financialAccount?.code ?? undefined} />
              <DetailField label="Category" value={detail.ledgerAccount?.name ?? "—"} sub={detail.ledgerAccount?.code ?? undefined} />
              <DetailField label="Department" value={detail.department?.name ?? "—"} />
              <DetailField
                label="Payment Method"
                value={detail.paymentMethod ? PAYMENT_LABELS[detail.paymentMethod] ?? detail.paymentMethod : "—"}
              />
              <DetailField label="External Ref" value={detail.externalRef ?? "—"} mono />
              <DetailField label="Created By" value={detail.createdBy?.username ?? "—"} />
              <DetailField label="Created At" value={formatDateTime(detail.createdAt)} />
              <DetailField label="Posted At" value={formatDateTime(detail.postedAt)} />
            </div>

            {detail.notes && (
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Notes
                </p>
                <p className="mt-1 text-sm">{detail.notes}</p>
              </div>
            )}

            {(detail.reverses || detail.reversedBy || detail.reversalReason) && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Reversal Info
                </p>
                {detail.reversalReason && (
                  <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                    Reason: {detail.reversalReason}
                  </p>
                )}
                {detail.reverses && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                    Reverses original: <span className="font-mono">{detail.reverses.reference}</span>
                  </p>
                )}
                {detail.reversedBy && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                    Reversed by: <span className="font-mono">{detail.reversedBy.reference}</span>
                  </p>
                )}
              </div>
            )}

            {/* Journal entries */}
            <div className="rounded-md border">
              <div className="border-b bg-muted/30 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Journal Entries
                </p>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-transparent">
                      <TableHead className="h-8 text-[11px]">Account</TableHead>
                      <TableHead className="h-8 text-[11px]">Category</TableHead>
                      <TableHead className="h-8 text-right text-[11px]">Debit</TableHead>
                      <TableHead className="h-8 text-right text-[11px]">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.entries.map((e) => (
                      <TableRow key={e.id} className="text-xs">
                        <TableCell className="py-2">
                          <span className="font-mono text-[11px]">{e.financialAccountCode}</span>{" "}
                          {e.financialAccountName}
                        </TableCell>
                        <TableCell className="py-2">
                          {e.ledgerAccountCode ? (
                            <>
                              <span className="font-mono text-[11px]">{e.ledgerAccountCode}</span>{" "}
                              {e.ledgerAccountName}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {Number(e.debit) > 0 ? formatMoney(e.debit, currency) : "—"}
                        </TableCell>
                        <TableCell className="py-2 text-right tabular-nums text-rose-600 dark:text-rose-400">
                          {Number(e.credit) > 0 ? formatMoney(e.credit, currency) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Unable to load transaction detail.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {isReversible && (
            <Button
              variant="outline"
              className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
              onClick={() => onReverse(transaction)}
            >
              <Undo2 className="h-4 w-4" />
              Reverse transaction
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailField({
  label,
  value,
  sub,
  mono,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("truncate text-sm font-medium", mono && "font-mono")}>{value}</p>
      {sub && <p className="truncate text-[11px] text-muted-foreground font-mono">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reverse Transaction Dialog (custom — needs a reason input)
// ---------------------------------------------------------------------------
interface ReverseDialogProps {
  transaction: TransactionListItem | null;
  onOpenChange: (open: boolean) => void;
  onReversed: () => void;
}

function ReverseTransactionDialog({
  transaction,
  onOpenChange,
  onReversed,
}: ReverseDialogProps) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const open = !!transaction;

  useEffect(() => {
    if (!transaction) setReason("");
  }, [transaction]);

  const reasonValid = reason.trim().length >= 3;

  async function handleConfirm() {
    if (!transaction) return;
    if (!reasonValid) {
      toast.error("A reversal reason (min 3 chars) is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/finance/transactions/${transaction.id}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) throw new Error(await readError(res));
      toast.success(`Transaction ${transaction.reference} reversed.`);
      onOpenChange(false);
      onReversed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reverse transaction.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reverse this transaction?</AlertDialogTitle>
          <AlertDialogDescription>
            {transaction ? (
              <>
                Reversing <span className="font-mono">{transaction.reference}</span> posts a mirror
                journal entry that nets the original to zero. The original record is preserved with
                status <span className="font-medium">reversed</span>. This action is itself audited
                and cannot be undone.
              </>
            ) : (
              ""
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-1.5 py-2">
          <Label htmlFor="reverse-reason">Reason (min 3 chars)</Label>
          <Input
            id="reverse-reason"
            placeholder="e.g. Posted to wrong account — correcting entry."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          {!reasonValid && reason.length > 0 && (
            <p className="text-[11px] text-rose-600">Reason must be at least 3 characters.</p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={!reasonValid || saving}
            className={cn("border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300")}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reverse Transaction
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
