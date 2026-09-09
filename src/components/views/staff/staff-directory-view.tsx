"use client";

// ============================================================================
// LBMS Staff Directory View
// ----------------------------------------------------------------------------
// Lists all employees with search + filters (department, status, employment
// type) and pagination. Exposes a "New Employee" button (gated on
// can("staff","create")) and per-row actions: view profile, edit, deactivate.
//
// Each row carries `data-testid="employee-row-{employeeId}"` so that e2e
// tests can target employees by their human-readable identifier.
//
// Server-side permission enforcement lives on the API. UI buttons are also
// gated client-side via useAuth().can(...) for nicer UX.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  UserSquare,
  Plus,
  Search,
  MoreHorizontal,
  Eye,
  Pencil,
  Power,
  Loader2,
} from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type EmployeeStatus =
  | "active"
  | "probation"
  | "on_leave"
  | "suspended"
  | "resigned"
  | "terminated"
  | "retired"
  | "inactive";

type EmploymentType =
  | "full_time"
  | "part_time"
  | "contract"
  | "temporary"
  | "intern"
  | "consultant";

interface EmployeeListItem {
  id: string;
  employeeId: string;
  employeeNumber: string | null;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  gender: string | null;
  employmentType: string | null;
  status: string;
  department: { id: string; name: string } | null;
  position: { id: string; title: string } | null;
  manager: { id: string; fullName: string; employeeId: string } | null;
}

interface DepartmentOption {
  id: string;
  name: string;
  code: string | null;
}

interface ListResponse {
  items: EmployeeListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STATUS_BADGE: Record<string, { label: string; className: string; dot: string }> = {
  active: {
    label: "Active",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  probation: {
    label: "Probation",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  on_leave: {
    label: "On leave",
    className:
      "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
  },
  suspended: {
    label: "Suspended",
    className:
      "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    dot: "bg-rose-500",
  },
  resigned: {
    label: "Resigned",
    className:
      "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
    dot: "bg-zinc-500",
  },
  terminated: {
    label: "Terminated",
    className:
      "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    dot: "bg-rose-500",
  },
  retired: {
    label: "Retired",
    className:
      "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    dot: "bg-violet-500",
  },
  inactive: {
    label: "Inactive",
    className:
      "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
    dot: "bg-zinc-400",
  },
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  temporary: "Temporary",
  intern: "Intern",
  consultant: "Consultant",
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "probation", label: "Probation" },
  { value: "on_leave", label: "On leave" },
  { value: "suspended", label: "Suspended" },
  { value: "inactive", label: "Inactive" },
];

const EMPLOYMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "temporary", label: "Temporary" },
  { value: "intern", label: "Intern" },
  { value: "consultant", label: "Consultant" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
  if (res.status === 404) return "The staff endpoint was not found.";
  if (res.status === 400) return "The request was invalid.";
  return `Request failed (${res.status}).`;
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export function StaffDirectoryView() {
  const { can } = useAuth();
  const canCreate = can("staff", "create");
  const canEdit = can("staff", "edit");
  const canDelete = can("staff", "delete");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("all");
  const [status, setStatus] = useState("all");
  const [employmentType, setEmploymentType] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  // Deactivation dialog state
  const [deactivateEmp, setDeactivateEmp] = useState<EmployeeListItem | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  function navigateToProfile(empId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "staff-profile");
    params.set("id", empId);
    router.push(`${pathname}?${params.toString()}`);
  }

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch departments (for the filter dropdown) — the existing
  // /api/departments endpoint returns a flat list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/departments");
        if (!res.ok) return;
        const json: { items: DepartmentOption[] } = await res.json();
        if (!cancelled) setDepartments(json.items ?? []);
      } catch {
        /* ignore — filter just stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch employees
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        });
        if (debouncedSearch) params.set("search", debouncedSearch);
        if (departmentId !== "all") params.set("departmentId", departmentId);
        if (status !== "all") params.set("status", status);
        if (employmentType !== "all") params.set("employmentType", employmentType);

        const res = await fetch(`/api/staff?${params.toString()}`);
        if (!res.ok) throw new Error(await readError(res));
        const json: ListResponse = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load staff.");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, departmentId, status, employmentType, page, pageSize, refreshKey]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const showEmpty = !loading && (!data || data.items.length === 0);
  const hasActiveFilters =
    !!debouncedSearch ||
    departmentId !== "all" ||
    status !== "all" ||
    employmentType !== "all";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Staff Directory"
        description="Manage Lightworld employees, contact info and employment status."
        action={
          canCreate ? (
            <Button data-testid="staff-create">
              <Plus className="h-4 w-4" />
              New Employee
            </Button>
          ) : null
        }
      />

      {/* Filters */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID, name, email, phone…"
            aria-label="Search staff"
            className="pl-9"
          />
        </div>
        <div>
          <Label htmlFor="dept-filter" className="sr-only">
            Filter by department
          </Label>
          <Select
            value={departmentId}
            onValueChange={(v) => {
              setDepartmentId(v);
              setPage(1);
            }}
          >
            <SelectTrigger id="dept-filter" className="w-full">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                  {d.code && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({d.code})
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="status-filter" className="sr-only">
            Filter by status
          </Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger id="status-filter" className="w-full">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="emp-type-filter" className="sr-only">
            Filter by employment type
          </Label>
          <Select
            value={employmentType}
            onValueChange={(v) => {
              setEmploymentType(v);
              setPage(1);
            }}
          >
            <SelectTrigger id="emp-type-filter" className="w-full">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <StaffTableSkeleton />
      ) : showEmpty ? (
        <EmptyState
          icon={UserSquare}
          title="No employees found"
          description={
            hasActiveFilters
              ? "Try adjusting your filters or search query."
              : "Get started by creating the first employee record."
          }
          action={
            canCreate && !hasActiveFilters ? (
              <Button>
                <Plus className="h-4 w-4" />
                New Employee
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
                  <TableHead>Employee #</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead className="w-[60px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((emp) => {
                  const sb = STATUS_BADGE[emp.status] ?? {
                    label: emp.status,
                    className:
                      "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
                    dot: "bg-zinc-400",
                  };
                  const empNumber = emp.employeeNumber ?? emp.employeeId;
                  return (
                    <TableRow key={emp.id} data-testid={`employee-row-${emp.employeeId}`}>
                      <TableCell className="font-mono text-xs">{empNumber}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                              {initials(emp.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{emp.fullName}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {emp.email ?? emp.phone ?? "—"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {emp.department ? emp.department.name : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {emp.position ? emp.position.title : "—"}
                      </TableCell>
                      <TableCell>
                        {emp.employmentType ? (
                          <span className="text-xs">
                            {EMPLOYMENT_LABELS[emp.employmentType] ?? emp.employmentType}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("gap-1.5", sb.className)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", sb.dot)} />
                          {sb.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {emp.manager ? (
                          <span className="text-xs">{emp.manager.fullName}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <RowActions
                          emp={emp}
                          canEdit={canEdit}
                          canDelete={canDelete}
                          onView={() => navigateToProfile(emp.id)}
                          onEdit={() => navigateToProfile(emp.id)}
                          onDeactivate={() => setDeactivateEmp(emp)}
                        />
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
      {data && data.items.length > 0 ? (
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
            employees
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
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
            </Button>
          </div>
        </div>
      ) : null}

      {/* Deactivate confirmation */}
      <ConfirmDialog
        open={!!deactivateEmp}
        onOpenChange={(o) => {
          if (!o) setDeactivateEmp(null);
        }}
        trigger={null}
        title="Deactivate employee?"
        description={
          deactivateEmp
            ? `This will mark ${deactivateEmp.fullName} (${deactivateEmp.employeeId}) as inactive. They will no longer appear in active staff lists but their record is retained for audit history.`
            : ""
        }
        confirmLabel="Deactivate"
        destructive
        onConfirm={async () => {
          if (!deactivateEmp) return;
          const emp = deactivateEmp;
          try {
            const res = await fetch(`/api/staff/${emp.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "inactive" }),
            });
            if (!res.ok) throw new Error(await readError(res));
            toast.success(`${emp.fullName} deactivated.`);
            refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to update status.");
            throw err;
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row actions menu
// ---------------------------------------------------------------------------
function RowActions({
  emp,
  canEdit,
  canDelete,
  onView,
  onEdit,
  onDeactivate,
}: {
  emp: EmployeeListItem;
  canEdit: boolean;
  canDelete: boolean;
  onView: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  if (!canEdit && !canDelete) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const isActive = emp.status === "active" || emp.status === "probation";
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Row actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={onView}>
            <Eye className="h-4 w-4" />
            View profile
          </DropdownMenuItem>
          {canEdit && (
            <DropdownMenuItem
              data-testid={`employee-edit-${emp.employeeId}`}
              onClick={onEdit}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </DropdownMenuItem>
          )}
          {canDelete && isActive && <DropdownMenuSeparator />}
          {canDelete && isActive && (
            <DropdownMenuItem variant="destructive" onClick={onDeactivate}>
              <Power className="h-4 w-4" />
              Deactivate
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function StaffTableSkeleton() {
  return (
    <div className="rounded-lg border bg-card">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Employee #</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="h-3 w-24" />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="space-y-1">
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="h-2.5 w-40" />
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Skeleton className="h-3 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-3 w-28" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-3 w-16" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-20 rounded-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-3 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-8 w-8 rounded-md" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// Re-export helpers for downstream views.
export { formatDate as formatStaffDate, initials as staffInitials };
