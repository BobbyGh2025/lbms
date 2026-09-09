"use client";

// ============================================================================
// LBMS Finance Categories View — Chart of Accounts
// ----------------------------------------------------------------------------
// Lists ledger categories grouped by accountClass (Asset / Liability / Equity
// / Income / Expense). Create dialog, class filter, status & isSystem badges.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  ListOrdered,
  Loader2,
  Scale,
  Wallet,
  PiggyBank,
  TrendingDown,
  TrendingUp,
  Lock,
} from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { ACCOUNT_CLASSES } from "@/lib/finance/constants";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CategoryItem {
  id: string;
  code: string;
  name: string;
  accountClass: string;
  accountType: string;
  currency: string;
  status: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  createdBy: string | null;
  usageCount: number;
}

interface ListResponse {
  items: CategoryItem[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CLASS_META: Record<
  string,
  { label: string; icon: typeof Wallet; badge: string; iconBg: string }
> = {
  asset: {
    label: "Assets",
    icon: Wallet,
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    iconBg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  liability: {
    label: "Liabilities",
    icon: Scale,
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    iconBg: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
  equity: {
    label: "Equity",
    icon: PiggyBank,
    badge: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    iconBg: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  income: {
    label: "Income",
    icon: TrendingUp,
    badge: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    iconBg: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  expense: {
    label: "Expenses",
    icon: TrendingDown,
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    iconBg: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
};

const STATUS_BADGE: Record<string, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  inactive: "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
};

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
export function FinanceCategoriesView() {
  const { can } = useAuth();
  const canManage = can("finance", "manage_categories");

  const [filter, setFilter] = useState<string>("all");
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (filter !== "all") qs.set("accountClass", filter);
        const res = await fetch(`/api/finance/categories?${qs.toString()}`);
        if (!res.ok) throw new Error(await readError(res));
        const json: ListResponse = await res.json();
        if (!cancelled) setCategories(json.items ?? []);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load categories.");
          setCategories([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, refreshKey]);

  // Group by class
  const grouped = useMemo(() => {
    const m = new Map<string, CategoryItem[]>();
    for (const c of categories) {
      const arr = m.get(c.accountClass) ?? [];
      arr.push(c);
      m.set(c.accountClass, arr);
    }
    return m;
  }, [categories]);

  // Always show all 5 classes in their canonical order, even if empty.
  const classOrder = ACCOUNT_CLASSES;

  const totalCategories = categories.length;
  const systemCount = categories.filter((c) => c.isSystem).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Chart of Accounts"
        description="Ledger categories grouped by class — used to classify every journal entry."
        action={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New Category
            </Button>
          ) : null
        }
      />

      {/* Filter strip */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Label htmlFor="cls-filter" className="sr-only">
            Filter by class
          </Label>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger id="cls-filter" className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              <SelectItem value="asset">Assets</SelectItem>
              <SelectItem value="liability">Liabilities</SelectItem>
              <SelectItem value="equity">Equity</SelectItem>
              <SelectItem value="income">Income</SelectItem>
              <SelectItem value="expense">Expenses</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {!loading && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{totalCategories}</span> categor
            {totalCategories === 1 ? "y" : "ies"} · {systemCount} system
          </p>
        )}
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-lg" />
          ))}
        </div>
      ) : totalCategories === 0 ? (
        <EmptyState
          icon={ListOrdered}
          title="No categories found"
          description={
            filter !== "all"
              ? `No ${filter} categories exist yet. Try a different filter or create a new one.`
              : "Create your first ledger category to start classifying journal entries."
          }
          action={
            canManage ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                New Category
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-4">
          {classOrder.map((cls) => {
            const list = grouped.get(cls) ?? [];
            if (list.length === 0) return null;
            const meta = CLASS_META[cls];
            const Icon = meta.icon;
            const totalUsage = list.reduce((s, c) => s + (c.usageCount || 0), 0);
            return (
              <Card key={cls}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <div className="flex items-center gap-2">
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-md", meta.iconBg)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <CardTitle className="text-sm capitalize">{meta.label}</CardTitle>
                      <p className="text-[11px] text-muted-foreground">
                        {list.length} categor{list.length === 1 ? "y" : "ies"} · {totalUsage} usage
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40">
                          <TableHead className="h-9 text-[11px]">Code</TableHead>
                          <TableHead className="h-9 text-[11px]">Name</TableHead>
                          <TableHead className="h-9 text-[11px]">Description</TableHead>
                          <TableHead className="h-9 text-right text-[11px]">Usage</TableHead>
                          <TableHead className="h-9 text-[11px]">Status</TableHead>
                          <TableHead className="h-9 text-[11px]">Type</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {list.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell className="font-mono text-xs">{c.code}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium">{c.name}</span>
                                {c.isSystem && (
                                  <Badge
                                    variant="outline"
                                    className="border-zinc-400/30 bg-zinc-400/10 text-[9px] text-zinc-600 dark:text-zinc-300"
                                  >
                                    <Lock className="h-2.5 w-2.5" />
                                    system
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[260px] text-xs text-muted-foreground">
                              <span className="truncate">{c.description ?? "—"}</span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {c.usageCount}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] capitalize",
                                  STATUS_BADGE[c.status] ??
                                    "border-zinc-400/30 bg-zinc-400/10 text-zinc-600",
                                )}
                              >
                                {c.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn("text-[10px] capitalize", meta.badge)}
                              >
                                {c.accountType}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateCategoryDialog
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
// Create Category Dialog
// ---------------------------------------------------------------------------
interface CreateCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CreateCategoryDialog({ open, onOpenChange }: CreateCategoryDialogProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [accountClass, setAccountClass] = useState<string>("expense");
  const [currency, setCurrency] = useState("GHS");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode("");
    setName("");
    setAccountClass("expense");
    setCurrency("GHS");
    setDescription("");
  }, [open]);

  const valid = !!code && code.length >= 2 && !!name && name.length >= 2 && !!accountClass;

  async function handleSubmit() {
    if (!valid) {
      toast.error("Please fill in code, name, and account class.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        accountClass,
        accountType: accountClass, // auto = class
        currency: currency.trim().toUpperCase(),
        description: description.trim() || undefined,
      };
      const res = await fetch("/api/finance/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readError(res));
      toast.success(`Category ${code.toUpperCase()} created.`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create category.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>New Ledger Category</DialogTitle>
          <DialogDescription>
            Add a new chart-of-accounts category. The account type defaults to the chosen class.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat-code">Code</Label>
              <Input
                id="cat-code"
                placeholder="e.g. INC-SVC"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-currency">Currency</Label>
              <Input
                id="cat-currency"
                placeholder="GHS"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                className="font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              placeholder="e.g. Service Revenue"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-class">Account Class</Label>
            <Select value={accountClass} onValueChange={setAccountClass}>
              <SelectTrigger id="cat-class" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asset">Asset</SelectItem>
                <SelectItem value="liability">Liability</SelectItem>
                <SelectItem value="equity">Equity</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Account type will be set to <span className="font-mono">{accountClass}</span> automatically.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-desc">Description</Label>
            <Textarea
              id="cat-desc"
              placeholder="Optional internal description…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!valid || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
