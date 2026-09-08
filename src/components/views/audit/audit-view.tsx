"use client";

// ============================================================================
// LBMS Audit Trail Viewer (READ-ONLY)
// ----------------------------------------------------------------------------
// Renders the immutable audit log. The whole view is gated on `audit:view`
// (MD bypasses). Filters, pagination, expandable rows for diff values, and
// small summary cards at the top powered by /api/audit/stats.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Boxes,
  ChevronDown,
  ChevronRight,
  Clock,
  History,
  Lock,
  RotateCcw,
  ScrollText,
  Search,
  ShieldAlert,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { PERMISSION_MODULES } from "@/lib/permissions";
import { cn } from "@/lib/utils";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditUser {
  id: string;
  email: string;
  name: string;
}

interface AuditListItem {
  id: string;
  userId: string | null;
  action: string;
  module: string;
  recordId: string | null;
  recordType: string | null;
  description: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  previousValue: string | null;
  newValue: string | null;
  createdAt: string;
  user: AuditUser | null;
}

interface AuditListResponse {
  items: AuditListItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface AuditStatsResponse {
  total: number;
  last24h: number;
  byModule: Record<string, number>;
  byAction: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

/** "auth" appears in audit logs (login/logout) but not in PERMISSION_MODULES. */
const MODULE_OPTIONS: string[] = [
  "auth",
  ...PERMISSION_MODULES.filter((m) => m !== "dashboard"),
].sort((a, b) => a.localeCompare(b));

const ACTION_OPTIONS = [
  "login",
  "logout",
  "login_failed",
  "create",
  "update",
  "delete",
  "approve",
  "reject",
  "view_sensitive",
  "export",
  "system",
] as const;

const ACTION_BADGE_STYLES: Record<string, string> = {
  login: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  logout: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/30",
  login_failed: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
  create: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  update: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  delete: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
  approve: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  reject: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
  view_sensitive: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
  export: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  system: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/30",
};

const MODULE_BADGE_STYLE =
  "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function actionBadgeClass(action: string): string {
  return ACTION_BADGE_STYLES[action] ?? ACTION_BADGE_STYLES.system;
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function formatFull(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function prettyJson(raw: string | null): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function topEntry(map: Record<string, number> | undefined): { key: string; count: number } | null {
  if (!map) return null;
  const entries = Object.entries(map);
  if (entries.length === 0) return null;
  const [firstKey, firstCount] = entries[0];
  return entries.reduce<{ key: string; count: number }>(
    (best, [key, count]) => (count > best.count ? { key, count } : best),
    { key: firstKey, count: firstCount },
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  loading,
}: {
  label: string;
  value: string | number | null;
  hint?: string;
  icon: typeof Activity;
  loading?: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-muted-foreground">
            {label}
          </p>
          {loading ? (
            <Skeleton className="mt-1 h-5 w-20" />
          ) : (
            <p className="truncate text-base font-bold tracking-tight">
              {value ?? "—"}
            </p>
          )}
          {hint && !loading && (
            <p className="truncate text-[10px] text-muted-foreground">{hint}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: readonly string[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-[170px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{placeholder}</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt}>
            <span className="capitalize">{opt.replace(/_/g, " ")}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AccessDenied() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold">Access denied</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            You do not have permission to view the audit trail. Contact an
            administrator if you believe this is an error.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function AuditView() {
  const { can, isLoading: authLoading } = useAuth();
  const allowed = can("audit", "view");

  // --- list state ---
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [moduleFilter, setModuleFilter] = useState("__all__");
  const [actionFilter, setActionFilter] = useState("__all__");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AuditListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // --- stats state ---
  const [stats, setStats] = useState<AuditStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // --- debounce search input ---
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchDebounced(search);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // --- fetch stats once ---
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    (async () => {
      try {
        setStatsLoading(true);
        const res = await fetch("/api/audit/stats", { cache: "no-store" });
        if (!res.ok) throw new Error("stats fetch failed");
        const json = (await res.json()) as AuditStatsResponse;
        if (!cancelled) setStats(json);
      } catch {
        // silent — stat cards show "—"
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  // --- fetch list when filters change ---
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;

    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    if (searchDebounced) params.set("search", searchDebounced);
    if (moduleFilter !== "__all__") params.set("module", moduleFilter);
    if (actionFilter !== "__all__") params.set("action", actionFilter);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);

    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/audit?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("audit fetch failed");
        const json = (await res.json()) as AuditListResponse;
        if (!cancelled) {
          setItems(json.items);
          setTotal(json.total);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, page, searchDebounced, moduleFilter, actionFilter, dateFrom, dateTo]);

  // --- filter mutators (reset to page 1 on change) ---
  const onSearchChange = useCallback((v: string) => {
    setSearch(v);
    setPage(1);
  }, []);
  const onModuleChange = useCallback((v: string) => {
    setModuleFilter(v);
    setPage(1);
  }, []);
  const onActionChange = useCallback((v: string) => {
    setActionFilter(v);
    setPage(1);
  }, []);
  const onDateFromChange = useCallback((v: string) => {
    setDateFrom(v);
    setPage(1);
  }, []);
  const onDateToChange = useCallback((v: string) => {
    setDateTo(v);
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setSearchDebounced("");
    setModuleFilter("__all__");
    setActionFilter("__all__");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }, []);

  const hasActiveFilters =
    !!searchDebounced ||
    moduleFilter !== "__all__" ||
    actionFilter !== "__all__" ||
    !!dateFrom ||
    !!dateTo;

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const topModule = useMemo(() => topEntry(stats?.byModule), [stats]);
  const topAction = useMemo(() => topEntry(stats?.byAction), [stats]);

  // --------------------------------------------------------------------- render

  if (authLoading) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Audit Trail"
          description="Immutable record of all important actions across the system."
        />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Audit Trail"
          description="Immutable record of all important actions across the system."
        />
        <AccessDenied />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Trail"
        description="Immutable record of all important actions across the system."
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Total entries"
          value={stats?.total ?? null}
          icon={ScrollText}
          loading={statsLoading}
          hint="All-time recorded events"
        />
        <StatCard
          label="Last 24h"
          value={stats?.last24h ?? null}
          icon={Clock}
          loading={statsLoading}
          hint="Activity in past day"
        />
        <StatCard
          label="Top module"
          value={topModule ? topModule.key : null}
          hint={topModule ? `${topModule.count} entries` : undefined}
          icon={Boxes}
          loading={statsLoading}
        />
        <StatCard
          label="Top action"
          value={
            topAction
              ? topAction.key.replace(/_/g, " ")
              : null
          }
          hint={topAction ? `${topAction.count} entries` : undefined}
          icon={Activity}
          loading={statsLoading}
        />
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search description…"
                className="pl-8"
              />
            </div>
            <FilterSelect
              value={moduleFilter}
              onChange={onModuleChange}
              placeholder="All modules"
              options={MODULE_OPTIONS}
            />
            <FilterSelect
              value={actionFilter}
              onChange={onActionChange}
              placeholder="All actions"
              options={ACTION_OPTIONS}
            />
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => onDateFromChange(e.target.value)}
                aria-label="From date"
                className="w-[150px]"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => onDateToChange(e.target.value)}
                aria-label="To date"
                className="w-[150px]"
              />
            </div>
            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="h-9"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-8 pl-3" />
                <TableHead className="w-[150px]">When</TableHead>
                <TableHead className="min-w-[160px]">User</TableHead>
                <TableHead className="min-w-[120px]">Action</TableHead>
                <TableHead className="min-w-[110px]">Module</TableHead>
                <TableHead className="min-w-[260px]">Description</TableHead>
                <TableHead className="min-w-[120px]">IP address</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={`skeleton-${i}`}>
                    <TableCell colSpan={7} className="py-3">
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState
                      icon={hasActiveFilters ? Search : History}
                      title={
                        hasActiveFilters
                          ? "No matching audit entries"
                          : "No audit entries yet"
                      }
                      description={
                        hasActiveFilters
                          ? "Try adjusting or clearing your filters to see more results."
                          : "Audit events will appear here as users interact with the system."
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                items.flatMap((a) => {
                  const isExpanded = expanded.has(a.id);
                  const hasDetail =
                    !!a.previousValue || !!a.newValue || !!a.userAgent;
                  const rows = [
                    <TableRow
                      key={a.id}
                      onClick={() => hasDetail && toggleExpand(a.id)}
                      className={cn(
                        "transition-colors",
                        hasDetail && "cursor-pointer",
                        isExpanded && "bg-muted/30",
                      )}
                    >
                      <TableCell className="pl-3">
                        {hasDetail ? (
                          <span className="inline-flex text-muted-foreground">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell
                        title={formatFull(a.createdAt)}
                        className="text-xs text-muted-foreground"
                      >
                        {formatRelative(a.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {a.user ? (
                          <span className="flex flex-col">
                            <span className="font-medium">{a.user.email}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {a.user.name}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">
                            System
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "capitalize",
                            actionBadgeClass(a.action),
                          )}
                        >
                          {a.action.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("capitalize", MODULE_BADGE_STYLE)}
                        >
                          {a.module}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[420px]">
                        <span className="line-clamp-2 text-sm">
                          {a.description || (
                            <span className="text-muted-foreground italic">
                              —
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {a.ipAddress || (
                          <span className="italic text-muted-foreground/70">
                            —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>,
                  ];
                  if (isExpanded && hasDetail) {
                    rows.push(
                      <TableRow
                        key={`${a.id}-detail`}
                        className="bg-muted/20 hover:bg-muted/20"
                      >
                        <TableCell />
                        <TableCell colSpan={6} className="py-3">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div>
                              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Previous value
                              </p>
                              <pre className="overflow-x-auto rounded-md border bg-background p-3 text-[11px] leading-relaxed">
                                {prettyJson(a.previousValue) || (
                                  <span className="italic text-muted-foreground">
                                    — none —
                                  </span>
                                )}
                              </pre>
                            </div>
                            <div>
                              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                New value
                              </p>
                              <pre className="overflow-x-auto rounded-md border bg-background p-3 text-[11px] leading-relaxed">
                                {prettyJson(a.newValue) || (
                                  <span className="italic text-muted-foreground">
                                    — none —
                                  </span>
                                )}
                              </pre>
                            </div>
                            {(a.recordId || a.recordType || a.userAgent) && (
                              <div className="lg:col-span-2">
                                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Detail
                                </p>
                                <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                                  {a.recordType && (
                                    <div>
                                      <dt className="inline text-muted-foreground">
                                        Record type:{" "}
                                      </dt>
                                      <dd className="inline font-mono">
                                        {a.recordType}
                                      </dd>
                                    </div>
                                  )}
                                  {a.recordId && (
                                    <div>
                                      <dt className="inline text-muted-foreground">
                                        Record ID:{" "}
                                      </dt>
                                      <dd className="inline font-mono break-all">
                                        {a.recordId}
                                      </dd>
                                    </div>
                                  )}
                                  {a.userAgent && (
                                    <div className="sm:col-span-3">
                                      <dt className="inline text-muted-foreground">
                                        User agent:{" "}
                                      </dt>
                                      <dd className="inline break-all font-mono">
                                        {a.userAgent}
                                      </dd>
                                    </div>
                                  )}
                                </dl>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>,
                    );
                  }
                  return rows;
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            {loading ? (
              "Loading…"
            ) : (
              <>
                Showing{" "}
                <span className="font-medium text-foreground">
                  {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–
                  {Math.min(page * PAGE_SIZE, total)}
                </span>{" "}
                of{" "}
                <span className="font-medium text-foreground">{total}</span>{" "}
                entries
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!canPrev || loading}
              className="h-8"
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page <span className="font-medium text-foreground">{page}</span> of{" "}
              <span className="font-medium text-foreground">{totalPages}</span>
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={!canNext || loading}
              className="h-8"
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      {/* Footer note */}
      <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Audit logs are append-only and cannot be modified or deleted. Every
          important action — logins, record changes, approvals, exports and
          sensitive views — is recorded permanently.
        </span>
      </div>
    </div>
  );
}
