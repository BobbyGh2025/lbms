"use client";

// ============================================================================
// LBMS Finance Accounts View — Cash & Bank Accounts
// ----------------------------------------------------------------------------
// Grid of account cards with derived balances (via ?withBalances=true), plus
// a "New Account" dialog, edit dialog, and deactivate (status=inactive) flow.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Wallet,
  Pencil,
  Power,
  Loader2,
  Landmark,
  Building2,
} from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
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

// Detail (for edit prefill) — full account object
interface AccountDetail {
  id: string;
  code: string;
  name: string;
  accountType: string;
  currency: string;
  openingBalance: string;
  status: string;
  description: string | null;
  bankName: string | null;
  accountNumber: string | null;
  balance: string;
  postedDebits: string;
  postedCredits: string;
  transactionCount: number;
}

interface ListResponse {
  items: AccountBalance[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

const TYPE_BADGE: Record<string, string> = {
  asset: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  liability: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const STATUS_BADGE: Record<string, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  inactive: "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
};

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export function FinanceAccountsView() {
  const { can } = useAuth();
  const canManage = can("finance", "manage_accounts");

  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AccountBalance | null>(null);
  const [deactivating, setDeactivating] = useState<AccountBalance | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/finance/accounts?withBalances=true");
        if (!res.ok) throw new Error(await readError(res));
        const json: ListResponse = await res.json();
        if (!cancelled) setAccounts(json.items ?? []);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load accounts.");
          setAccounts([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const totalBalance = accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const totalTxCount = accounts.reduce((sum, a) => sum + (a.transactionCount || 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cash & Bank Accounts"
        description="Cash, bank, and mobile money accounts with live balances derived from posted journals."
        action={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New Account
            </Button>
          ) : null
        }
      />

      {/* Summary strip */}
      {!loading && accounts.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="p-3">
              <p className="text-[11px] text-muted-foreground">Total Accounts</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">{accounts.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[11px] text-muted-foreground">Combined Balance</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatMoney(totalBalance, accounts[0]?.currency ?? "GHS")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[11px] text-muted-foreground">Posted Entries</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">{totalTxCount}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No cash & bank accounts yet"
          description="Create your first financial account to start recording income, expenses, and transfers."
          action={
            canManage ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                New Account
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => {
            const isActive = true; // ?withBalances=true endpoint doesn't expose status; assume active (filtered server-side)
            return (
              <Card key={a.accountId} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-3 p-4">
                  {/* Top: code badge + name + actions */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {a.code}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] capitalize",
                            TYPE_BADGE[a.accountType] ??
                              "border-zinc-400/30 bg-zinc-400/10 text-zinc-600",
                          )}
                        >
                          {a.accountType}
                        </Badge>
                      </div>
                      <p className="mt-1.5 truncate text-sm font-semibold">{a.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {a.currency} · {a.transactionCount} entries
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Edit account"
                          onClick={() => setEditing(a)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {isActive && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-amber-600 hover:text-amber-700"
                            aria-label="Deactivate account"
                            onClick={() => setDeactivating(a)}
                          >
                            <Power className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Balance — hero */}
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Current Balance
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-2xl font-bold tabular-nums",
                        Number(a.balance) < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {formatMoney(a.balance, a.currency)}
                    </p>
                  </div>

                  {/* Breakdown */}
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Opening</p>
                      <p className="font-medium tabular-nums">
                        {formatMoney(a.openingBalance, a.currency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Debits</p>
                      <p className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatMoney(a.postedDebits, a.currency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Credits</p>
                      <p className="font-medium tabular-nums text-rose-600 dark:text-rose-400">
                        {formatMoney(a.postedCredits, a.currency)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AccountFormDialog
        open={createOpen}
        mode="create"
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) refresh();
        }}
      />
      <AccountFormDialog
        open={!!editing}
        mode="edit"
        account={editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
          refresh();
        }}
      />

      <ConfirmDialog
        open={!!deactivating}
        onOpenChange={(o) => {
          if (!o) setDeactivating(null);
        }}
        trigger={null}
        title="Deactivate account?"
        description={
          deactivating
            ? `Deactivating "${deactivating.name}" marks it as inactive. Existing posted entries are preserved. New transactions cannot be recorded against an inactive account.`
            : ""
        }
        confirmLabel="Deactivate"
        destructive
        onConfirm={async () => {
          if (!deactivating) return;
          try {
            const res = await fetch(`/api/finance/accounts/${deactivating.accountId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "inactive" }),
            });
            if (!res.ok) throw new Error(await readError(res));
            toast.success(`Account ${deactivating.code} deactivated.`);
            refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to deactivate account.");
            throw err;
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / Edit Account Dialog
// ---------------------------------------------------------------------------
interface AccountFormDialogProps {
  open: boolean;
  mode: "create" | "edit";
  account?: AccountBalance | null;
  onOpenChange: (open: boolean) => void;
}

function AccountFormDialog({ open, mode, account, onOpenChange }: AccountFormDialogProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<"asset" | "liability">("asset");
  const [currency, setCurrency] = useState("GHS");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [description, setDescription] = useState("");
  const [postOpeningBalance, setPostOpeningBalance] = useState(true);
  const [saving, setSaving] = useState(false);

  // For edit mode: fetch full detail (bankName / accountNumber / description / status)
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (!open) {
      setDetail(null);
      return;
    }
    if (mode === "create") {
      setCode("");
      setName("");
      setAccountType("asset");
      setCurrency("GHS");
      setOpeningBalance("0");
      setBankName("");
      setAccountNumber("");
      setDescription("");
      setPostOpeningBalance(true);
      return;
    }
    // Edit mode — prefill from passed account then fetch full detail
    if (account) {
      setCode(account.code);
      setName(account.name);
      setAccountType(account.accountType === "liability" ? "liability" : "asset");
      setCurrency(account.currency);
      setOpeningBalance(account.openingBalance);
      setBankName("");
      setAccountNumber("");
      setDescription("");
      setPostOpeningBalance(false);
      // Fetch full detail for bankName/accountNumber/description
      setLoadingDetail(true);
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch(`/api/finance/accounts/${account.accountId}`);
          if (!res.ok) return;
          const d: AccountDetail = await res.json();
          if (cancelled) return;
          setDetail(d);
          setBankName(d.bankName ?? "");
          setAccountNumber(d.accountNumber ?? "");
          setDescription(d.description ?? "");
        } catch {
          /* noop */
        } finally {
          if (!cancelled) setLoadingDetail(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [open, mode, account]);

  const validCreate =
    !!code &&
    code.length >= 2 &&
    !!name &&
    name.length >= 2 &&
    !!currency &&
    currency.length === 3 &&
    Number(openingBalance) >= 0;

  const validEdit = !!name && name.length >= 2;

  async function handleSubmit() {
    if (mode === "create" && !validCreate) {
      toast.error("Please fill in code, name, currency, and a non-negative opening balance.");
      return;
    }
    if (mode === "edit" && !validEdit) {
      toast.error("Account name must be at least 2 characters.");
      return;
    }
    setSaving(true);
    try {
      if (mode === "create") {
        const payload: Record<string, unknown> = {
          code: code.trim().toUpperCase(),
          name: name.trim(),
          accountType,
          currency: currency.trim().toUpperCase(),
          openingBalance: String(openingBalance),
          bankName: bankName.trim() || undefined,
          accountNumber: accountNumber.trim() || undefined,
          description: description.trim() || undefined,
          postOpeningBalance,
        };
        const res = await fetch("/api/finance/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await readError(res));
        toast.success(`Account ${code.toUpperCase()} created.`);
      } else if (mode === "edit" && account) {
        const payload: Record<string, unknown> = {
          name: name.trim(),
          bankName: bankName.trim() || null,
          accountNumber: accountNumber.trim() || null,
          description: description.trim() || null,
        };
        const res = await fetch(`/api/finance/accounts/${account.accountId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await readError(res));
        toast.success(`Account ${account.code} updated.`);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save account.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New Cash / Bank Account" : `Edit Account ${account?.code ?? ""}`}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create a new financial account. An optional opening balance journal will be posted automatically."
              : "Update account name, bank details, and description. Code, type, currency, and opening balance cannot be changed after creation."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="acc-code">Code</Label>
              <Input
                id="acc-code"
                placeholder="e.g. CASH-01"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                disabled={mode === "edit"}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-currency">Currency</Label>
              <Input
                id="acc-currency"
                placeholder="GHS"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                disabled={mode === "edit"}
                maxLength={3}
                className="font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acc-name">Account Name</Label>
            <Input
              id="acc-name"
              placeholder="e.g. Main Operating Account"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="acc-type">Account Type</Label>
              <Select
                value={accountType}
                onValueChange={(v) => setAccountType(v as "asset" | "liability")}
                disabled={mode === "edit"}
              >
                <SelectTrigger id="acc-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asset">Asset (Cash/Bank)</SelectItem>
                  <SelectItem value="liability">Liability (Credit line)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-opening">Opening Balance</Label>
              <Input
                id="acc-opening"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                disabled={mode === "edit"}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="acc-bank" className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> Bank Name
              </Label>
              <Input
                id="acc-bank"
                placeholder="e.g. Stanbic Bank Ghana"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-number" className="flex items-center gap-1.5">
                <Landmark className="h-3.5 w-3.5 text-muted-foreground" /> Account Number
              </Label>
              <Input
                id="acc-number"
                placeholder="Last 4 or full #"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acc-desc">Description</Label>
            <Textarea
              id="acc-desc"
              placeholder="Optional internal description…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          {mode === "create" && Number(openingBalance) > 0 && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <Checkbox
                id="acc-post-opb"
                checked={postOpeningBalance}
                onCheckedChange={(v) => setPostOpeningBalance(v === true)}
              />
              <Label htmlFor="acc-post-opb" className="text-xs">
                Post opening balance as an opening journal entry (debits this account, credits owner&apos;s equity).
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="account-submit"
            onClick={handleSubmit}
            disabled={saving || (mode === "create" ? !validCreate : !validEdit) || loadingDetail}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "create" ? "Create Account" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
