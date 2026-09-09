"use client";

// ============================================================================
// LBMS Finance Expenses View
// ----------------------------------------------------------------------------
// Lists posted/draft expense transactions, supports search + date + department
// filters, and exposes a "Record Expense" dialog that POSTs to
// /api/finance/expenses. Expenses are department-attributed, so the department
// filter is front-and-center here.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, TrendingDown, Search, Loader2 } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useAuth } from "@/hooks/use-auth";
import { formatMoney } from "@/lib/finance/money";
import { PAYMENT_METHODS } from "@/lib/finance/constants";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AccountOption {
  id: string;
  code: string;
  name: string;
  currency: string;
  accountType: string;
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

interface ExpenseListItem {
  id: string;
  reference: string;
  transactionDate: string;
  amount: string;
  currency: string;
  description: string | null;
  status: string;
  paymentMethod: string | null;
  externalRef: string | null;
  financialAccount: { id: string; name: string; code: string } | null;
  ledgerAccount: { id: string; name: string; code: string } | null;
  department: { id: string; name: string } | null;
  createdBy: string | null;
}

interface ListResponse {
  items: ExpenseListItem[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const STATUS_BADGE: Record<string, string> = {
  posted: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  draft: "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
  voided: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  reversed: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  mobile_money: "Mobile money",
  card: "Card",
  cheque: "Cheque",
  other: "Other",
};

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data?.error) return data.error as string;
    if (data?.details) return JSON.stringify(data.details);
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
export function FinanceExpensesView() {
  const { can } = useAuth();
  const canCreate = can("finance", "create");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [departmentId, setDepartmentId] = useState("all");
  const [data, setData] = useState<ExpenseListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch departments once for the filter dropdown
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/departments");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setDepartments(json.items ?? []);
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
        if (departmentId !== "all") qs.set("departmentId", departmentId);
        const res = await fetch(`/api/finance/expenses?${qs.toString()}`);
        if (!res.ok) throw new Error(await readError(res));
        const json: ListResponse = await res.json();
        if (!cancelled) setData(json.items ?? []);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load expense records.");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, departmentId, refreshKey]);

  const filtered = (data ?? []).filter((item) => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    return (
      item.reference.toLowerCase().includes(q) ||
      (item.description ?? "").toLowerCase().includes(q) ||
      (item.externalRef ?? "").toLowerCase().includes(q)
    );
  });

  const showEmpty = !loading && filtered.length === 0;
  const displayCurrency = filtered[0]?.currency ?? data?.[0]?.currency ?? "GHS";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expenditure"
        description="Recorded expense transactions, attributable to departments."
        action={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Record Expense
            </Button>
          ) : null
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reference, description…"
            aria-label="Search expenses"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="dept-filter" className="text-[11px] text-muted-foreground">
              Department
            </Label>
            <Select
              value={departmentId}
              onValueChange={(v) => setDepartmentId(v)}
            >
              <SelectTrigger id="dept-filter" className="w-[180px]">
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
            <Label htmlFor="exp-from" className="text-[11px] text-muted-foreground">
              From
            </Label>
            <Input
              id="exp-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-[150px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="exp-to" className="text-[11px] text-muted-foreground">
              To
            </Label>
            <Input
              id="exp-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-[150px]"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <ExpenseTableSkeleton />
      ) : showEmpty ? (
        <EmptyState
          icon={TrendingDown}
          title="No expense records found"
          description={
            debouncedSearch || from || to || departmentId !== "all"
              ? "Try adjusting your filters or date range."
              : "Get started by recording your first expense."
          }
          action={
            canCreate && !debouncedSearch && !from && !to && departmentId === "all" ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Record Expense
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Reference</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="font-mono text-xs">{tx.reference}</TableCell>
                    <TableCell className="text-xs">{formatDate(tx.transactionDate)}</TableCell>
                    <TableCell className="max-w-[220px]">
                      <p className="truncate text-sm font-medium">{tx.description ?? "—"}</p>
                      {tx.externalRef && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          Ext: {tx.externalRef}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {tx.financialAccount ? (
                        <div className="min-w-0">
                          <p className="truncate text-sm">{tx.financialAccount.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {tx.financialAccount.code}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {tx.ledgerAccount ? (
                        <div className="min-w-0">
                          <p className="truncate text-sm">{tx.ledgerAccount.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {tx.ledgerAccount.code}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {tx.department ? tx.department.name : "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-400",
                      )}
                    >
                      −{formatMoney(tx.amount, tx.currency || displayCurrency)}
                    </TableCell>
                    <TableCell>
                      {tx.paymentMethod ? (
                        <span className="text-xs">
                          {PAYMENT_LABELS[tx.paymentMethod] ?? tx.paymentMethod}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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
                    <TableCell className="text-xs text-muted-foreground">
                      {tx.createdBy ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {data && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {data.length} expense record
          {data.length === 1 ? "" : "s"}.
        </p>
      )}

      <RecordExpenseDialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) refresh();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function ExpenseTableSkeleton() {
  return (
    <div className="rounded-lg border bg-card">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Reference</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Department</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 10 }).map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-3 w-full max-w-[110px]" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record Expense Dialog
// ---------------------------------------------------------------------------
interface RecordExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function RecordExpenseDialog({ open, onOpenChange }: RecordExpenseDialogProps) {
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [departmentId, setDepartmentId] = useState("__none__");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"posted" | "draft">("posted");
  const [saving, setSaving] = useState(false);

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  useEffect(() => {
    if (!open) return;
    setDate(todayISO());
    setAmount("");
    setAccountId("");
    setCategoryId("");
    setDescription("");
    setPaymentMethod("");
    setExternalRef("");
    setDepartmentId("__none__");
    setNotes("");
    setStatus("posted");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [accRes, catRes, depRes] = await Promise.all([
          fetch("/api/finance/accounts"),
          fetch("/api/finance/categories?accountClass=expense"),
          fetch("/api/departments"),
        ]);
        const [acc, cat, dep] = await Promise.all([
          accRes.ok ? accRes.json() : { items: [] },
          catRes.ok ? catRes.json() : { items: [] },
          depRes.ok ? depRes.json() : { items: [] },
        ]);
        if (cancelled) return;
        setAccounts(acc.items ?? []);
        setCategories(cat.items ?? []);
        setDepartments(dep.items ?? []);
      } catch {
        if (!cancelled) {
          setAccounts([]);
          setCategories([]);
          setDepartments([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selectedAccount = accounts.find((a) => a.id === accountId);
  const currency = selectedAccount?.currency ?? "GHS";

  const valid =
    !!date && !!amount && Number(amount) > 0 && !!accountId && !!categoryId;

  async function handleSubmit() {
    if (!valid) {
      toast.error("Please fill in date, amount, account, and category.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        date,
        amount: String(amount),
        financialAccountId: accountId,
        ledgerAccountId: categoryId,
        description: description.trim() || undefined,
        notes: notes.trim() || undefined,
        paymentMethod: paymentMethod || undefined,
        externalRef: externalRef.trim() || undefined,
        status,
      };
      if (departmentId !== "__none__") payload.departmentId = departmentId;
      const res = await fetch("/api/finance/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readError(res));
      toast.success("Expense recorded.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record expense.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Record Expense</DialogTitle>
          <DialogDescription>
            Post an expense transaction. Money is credited out of the cash/bank account and debited to the chosen expense category.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="exp-date">Date</Label>
              <Input
                id="exp-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-amount">
                Amount{" "}
                {currency ? <span className="text-muted-foreground">({currency})</span> : null}
              </Label>
              <Input
                id="exp-amount"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exp-account">Paying Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="exp-account" className="w-full">
                <SelectValue placeholder="Select account…" />
              </SelectTrigger>
              <SelectContent>
                {accounts.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    No active accounts
                  </SelectItem>
                ) : (
                  accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.code} · {a.name} ({a.currency})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exp-category">Expense Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="exp-category" className="w-full">
                <SelectValue placeholder="Select category…" />
              </SelectTrigger>
              <SelectContent>
                {categories.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    No expense categories
                  </SelectItem>
                ) : (
                  categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exp-desc">Description</Label>
            <Input
              id="exp-desc"
              placeholder="e.g. Office supplies purchase"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="exp-pay">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger id="exp-pay" className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {PAYMENT_LABELS[m] ?? m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-dept">Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id="exp-dept" className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exp-ext">External Reference</Label>
            <Input
              id="exp-ext"
              placeholder="e.g. Receipt #R-2025-0142"
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exp-notes">Notes</Label>
            <Textarea
              id="exp-notes"
              placeholder="Optional internal notes…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exp-status">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as "posted" | "draft")}
            >
              <SelectTrigger id="exp-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="posted">Posted (affects balances)</SelectItem>
                <SelectItem value="draft">Draft (does not affect balances)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!valid || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Record Expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
