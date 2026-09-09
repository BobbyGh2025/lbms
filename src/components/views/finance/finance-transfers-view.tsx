"use client";

// ============================================================================
// LBMS Finance Transfers View
// ----------------------------------------------------------------------------
// Lists posted inter-account transfers and exposes a "New Transfer" dialog.
// Transfers move money between two cash/bank accounts without affecting
// income or expense totals.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, ArrowLeftRight, ArrowRight, Loader2, Search } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

interface TransferListItem {
  id: string;
  reference: string;
  transactionDate: string;
  amount: string;
  currency: string;
  description: string | null;
  externalRef: string | null;
  fromAccount: { id: string; name: string; code: string } | null;
  toAccount: { id: string; name: string; code: string } | null;
}

interface ListResponse {
  items: TransferListItem[];
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
export function FinanceTransfersView() {
  const { can } = useAuth();
  const canCreate = can("finance", "create");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [data, setData] = useState<TransferListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/finance/transfers`);
        if (!res.ok) throw new Error(await readError(res));
        const json: ListResponse = await res.json();
        if (!cancelled) setData(json.items ?? []);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load transfers.");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const filtered = (data ?? []).filter((t) => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    return (
      t.reference.toLowerCase().includes(q) ||
      (t.description ?? "").toLowerCase().includes(q) ||
      (t.externalRef ?? "").toLowerCase().includes(q) ||
      (t.fromAccount?.name ?? "").toLowerCase().includes(q) ||
      (t.toAccount?.name ?? "").toLowerCase().includes(q)
    );
  });

  const showEmpty = !loading && filtered.length === 0;
  const displayCurrency = filtered[0]?.currency ?? data?.[0]?.currency ?? "GHS";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transfers"
        description="Move money between cash & bank accounts without affecting income or expenses."
        action={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New Transfer
            </Button>
          ) : null
        }
      />

      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reference, account, description…"
          aria-label="Search transfers"
          className="pl-9"
        />
      </div>

      {loading ? (
        <TransfersTableSkeleton />
      ) : showEmpty ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No transfers yet"
          description={
            debouncedSearch
              ? "Try adjusting your search query."
              : "Transfers move money between cash & bank accounts (e.g. cash to bank, bank to mobile money) without affecting income or expense totals. Create your first transfer to get started."
          }
          action={
            canCreate && !debouncedSearch ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                New Transfer
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
                  <TableHead>From → To</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                    <TableCell className="text-xs">{formatDate(t.transactionDate)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {t.fromAccount?.name ?? "—"}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {t.fromAccount?.code ?? ""}
                          </p>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {t.toAccount?.name ?? "—"}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {t.toAccount?.code ?? ""}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <p className="truncate text-sm">{t.description ?? "—"}</p>
                      {t.externalRef && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          Ref: {t.externalRef}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums text-sky-600 dark:text-sky-400">
                      {formatMoney(t.amount, t.currency || displayCurrency)}
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
          Showing {filtered.length} of {data.length} transfer{data.length === 1 ? "" : "s"}.
        </p>
      )}

      <NewTransferDialog
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
function TransfersTableSkeleton() {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead>Reference</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>From → To</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: 5 }).map((__, j) => (
                <TableCell key={j}>
                  <Skeleton className="h-3 w-full max-w-[140px]" />
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
// New Transfer Dialog
// ---------------------------------------------------------------------------
interface NewTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function NewTransferDialog({ open, onOpenChange }: NewTransferDialogProps) {
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [description, setDescription] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"posted" | "draft">("posted");
  const [saving, setSaving] = useState(false);

  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  useEffect(() => {
    if (!open) return;
    setDate(todayISO());
    setAmount("");
    setFromId("");
    setToId("");
    setDescription("");
    setExternalRef("");
    setNotes("");
    setStatus("posted");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/finance/accounts");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setAccounts(json.items ?? []);
      } catch {
        if (!cancelled) setAccounts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const fromAccount = accounts.find((a) => a.id === fromId);
  const toAccount = accounts.find((a) => a.id === toId);
  const sameAccount = !!fromId && !!toId && fromId === toId;
  const currencyMismatch =
    !!fromAccount && !!toAccount && fromAccount.currency !== toAccount.currency;
  const valid =
    !!date &&
    !!amount &&
    Number(amount) > 0 &&
    !!fromId &&
    !!toId &&
    !sameAccount &&
    !currencyMismatch;

  async function handleSubmit() {
    if (!valid) {
      if (sameAccount) toast.error("Source and destination accounts cannot be the same.");
      else if (currencyMismatch)
        toast.error("Cross-currency transfers are not supported in Phase 2.");
      else toast.error("Please fill in date, amount, and both accounts.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        date,
        amount: String(amount),
        fromAccountId: fromId,
        toAccountId: toId,
        description: description.trim() || undefined,
        notes: notes.trim() || undefined,
        externalRef: externalRef.trim() || undefined,
        status,
      };
      const res = await fetch("/api/finance/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readError(res));
      toast.success("Transfer posted.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post transfer.");
    } finally {
      setSaving(false);
    }
  }

  const currency = fromAccount?.currency ?? toAccount?.currency ?? "GHS";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New Transfer</DialogTitle>
          <DialogDescription>
            Move money between two cash & bank accounts. The transfer does not affect income or expense totals.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="trf-date">Date</Label>
              <Input
                id="trf-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trf-amount">
                Amount{" "}
                {currency ? <span className="text-muted-foreground">({currency})</span> : null}
              </Label>
              <Input
                id="trf-amount"
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
            <Label htmlFor="trf-from">From Account</Label>
            <Select value={fromId} onValueChange={setFromId}>
              <SelectTrigger id="trf-from" className="w-full">
                <SelectValue placeholder="Select source account…" />
              </SelectTrigger>
              <SelectContent>
                {accounts.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    No active accounts
                  </SelectItem>
                ) : (
                  accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id} disabled={a.id === toId}>
                      {a.code} · {a.name} ({a.currency})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trf-to">To Account</Label>
            <Select value={toId} onValueChange={setToId}>
              <SelectTrigger id="trf-to" className="w-full">
                <SelectValue placeholder="Select destination account…" />
              </SelectTrigger>
              <SelectContent>
                {accounts.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    No active accounts
                  </SelectItem>
                ) : (
                  accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id} disabled={a.id === fromId}>
                      {a.code} · {a.name} ({a.currency})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {(sameAccount || currencyMismatch) && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {sameAccount &&
                "Source and destination accounts must be different."}
              {currencyMismatch &&
                !sameAccount &&
                `Cross-currency transfers are not supported in Phase 2 (${fromAccount?.currency} → ${toAccount?.currency}).`}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="trf-desc">Description</Label>
            <Input
              id="trf-desc"
              placeholder="e.g. Move operating cash to bank"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trf-ext">External Reference</Label>
            <Input
              id="trf-ext"
              placeholder="e.g. Bank transfer ref #"
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trf-notes">Notes</Label>
            <Textarea
              id="trf-notes"
              placeholder="Optional internal notes…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trf-status">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as "posted" | "draft")}
            >
              <SelectTrigger id="trf-status" className="w-full">
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!valid || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Post Transfer
          </Button>
        </DialogFooter>

        {accounts.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {accounts.length} active account{accounts.length === 1 ? "" : "s"} available.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
