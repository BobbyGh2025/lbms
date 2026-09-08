"use client";

// ============================================================================
// LBMS Users View — admin UI for the Users module
// ----------------------------------------------------------------------------
// Lists users, supports search + status filter + pagination, and exposes
// create / edit / manage-roles / reset-password / activate-deactivate /
// delete actions via dialogs. All mutations are optimistic (refetch on
// success) and surface feedback via sonner toasts.
//
// Server-side permission enforcement lives on the API. UI buttons are also
// gated client-side via useAuth().can(...) for nicer UX.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Users as UsersIcon,
  Search,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  KeyRound,
  Trash2,
  Power,
  XCircle,
  Loader2,
  ChevronsUpDown,
} from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type UserStatus = "active" | "inactive" | "suspended";

interface UserListItem {
  id: string;
  email: string;
  username: string;
  status: UserStatus;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  employee: { id: string; employeeId: string; fullName: string } | null;
  roles: Array<{ id: string; name: string; displayName: string }>;
}

interface EmployeeOption {
  id: string;
  employeeId: string;
  fullName: string;
  departmentName: string | null;
}

interface RoleOption {
  id: string;
  name: string;
  displayName: string;
  isSystem: boolean;
  description: string | null;
}

interface ListResponse {
  items: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STATUS_BADGE: Record<
  UserStatus,
  { label: string; className: string; dot: string }
> = {
  active: {
    label: "Active",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  inactive: {
    label: "Inactive",
    className:
      "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
    dot: "bg-zinc-500",
  },
  suspended: {
    label: "Suspended",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
};

const ROLE_BADGE: Record<string, string> = {
  md: "border-primary/30 bg-primary/10 text-primary",
  administrator: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  finance_manager:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  hr_manager:
    "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  operations_manager:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  project_manager:
    "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  employee: "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
};

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
    // ignore — fall through to status text
  }
  if (res.status === 401) return "You are not signed in.";
  if (res.status === 403) return "You are not authorized to perform this action.";
  if (res.status === 404) return "The user was not found.";
  if (res.status === 400) return "The request was invalid.";
  return `Request failed (${res.status}).`;
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export function UsersView() {
  const { can } = useAuth();
  const canCreate = can("users", "create");
  const canEdit = can("users", "edit");
  const canDelete = can("users", "delete");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | UserStatus>("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  const [rolesUser, setRolesUser] = useState<UserListItem | null>(null);
  const [resetUser, setResetUser] = useState<UserListItem | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserListItem | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

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
        if (status !== "all") params.set("status", status);
        const res = await fetch(`/api/users?${params.toString()}`);
        if (!res.ok) throw new Error(await readError(res));
        const json: ListResponse = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load users.");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, status, page, pageSize, refreshKey]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const showEmpty = !loading && (!data || data.items.length === 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="User Management"
        description="Manage Lightworld staff accounts, roles, and access."
        action={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New User
            </Button>
          ) : null
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email or username…"
            aria-label="Search users"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="status-filter" className="sr-only">
            Filter by status
          </Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as typeof status);
              setPage(1);
            }}
          >
            <SelectTrigger id="status-filter" className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <UsersTableSkeleton />
      ) : showEmpty ? (
        <EmptyState
          icon={UsersIcon}
          title="No users found"
          description={
            debouncedSearch || status !== "all"
              ? "Try adjusting your filters or search query."
              : "Get started by creating the first user account."
          }
          action={
            canCreate && !debouncedSearch && status === "all" ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                New User
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>User</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[60px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((u) => {
                const sb = STATUS_BADGE[u.status];
                const isActive = u.status === "active";
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                            {initials(u.username || u.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{u.username}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {u.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.employee ? (
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {u.employee.fullName}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {u.employee.employeeId}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.roles.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No roles</span>
                      ) : (
                        <div className="flex max-w-[220px] flex-wrap gap-1">
                          {u.roles.slice(0, 3).map((r) => (
                            <Badge
                              key={r.id}
                              variant="outline"
                              className={cn(
                                "text-[10px] capitalize",
                                ROLE_BADGE[r.name] ??
                                  "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
                              )}
                            >
                              {r.displayName || r.name}
                            </Badge>
                          ))}
                          {u.roles.length > 3 && (
                            <Badge variant="outline" className="text-[10px]">
                              +{u.roles.length - 3}
                            </Badge>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("gap-1.5", sb.className)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", sb.dot)} />
                        {sb.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(u.lastLoginAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(u.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions
                        user={u}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        isActive={isActive}
                        onEdit={() => setEditingUser(u)}
                        onManageRoles={() => setRolesUser(u)}
                        onResetPassword={() => setResetUser(u)}
                        onToggleStatus={async () => {
                          await toggleStatus(u, isActive, refresh);
                        }}
                        onDelete={() => setDeleteUser(u)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
            users
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

      {/* Dialogs */}
      <UserFormDialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) refresh();
        }}
        mode="create"
      />
      <UserFormDialog
        open={!!editingUser}
        onOpenChange={(o) => {
          if (!o) setEditingUser(null);
          refresh();
        }}
        mode="edit"
        user={editingUser}
      />
      <RolesDialog
        user={rolesUser}
        onOpenChange={(o) => {
          if (!o) setRolesUser(null);
          refresh();
        }}
      />
      <ResetPasswordDialog
        user={resetUser}
        onOpenChange={(o) => {
          if (!o) setResetUser(null);
          refresh();
        }}
      />
      <ConfirmDialog
        open={!!deleteUser}
        onOpenChange={(o) => {
          if (!o) setDeleteUser(null);
        }}
        trigger={null}
        title="Delete user account?"
        description={
          deleteUser
            ? `This will soft-delete ${deleteUser.username} (${deleteUser.email}). The user will no longer be able to sign in, but the record is retained for audit history.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteUser) return;
          const u = deleteUser;
          try {
            const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
            if (!res.ok) throw new Error(await readError(res));
            toast.success(`User ${u.username} deleted.`);
            refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to delete user.");
            // Re-throw so ConfirmDialog keeps the dialog open for retry.
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
  user,
  canEdit,
  canDelete,
  isActive,
  onEdit,
  onManageRoles,
  onResetPassword,
  onToggleStatus,
  onDelete,
}: {
  user: UserListItem;
  canEdit: boolean;
  canDelete: boolean;
  isActive: boolean;
  onEdit: () => void;
  onManageRoles: () => void;
  onResetPassword: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  if (!canEdit && !canDelete) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {canEdit && (
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem onClick={onManageRoles}>
              <ShieldCheck className="h-4 w-4" />
              Manage roles
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem onClick={onResetPassword}>
              <KeyRound className="h-4 w-4" />
              Reset password
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem onClick={onToggleStatus}>
              {isActive ? (
                <>
                  <XCircle className="h-4 w-4" />
                  Deactivate
                </>
              ) : (
                <>
                  <Power className="h-4 w-4" />
                  Activate
                </>
              )}
            </DropdownMenuItem>
          )}
          {canDelete && (canEdit || canDelete) && <DropdownMenuSeparator />}
          {canDelete && (
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle status helper
// ---------------------------------------------------------------------------
async function toggleStatus(
  user: UserListItem,
  isActive: boolean,
  refresh: () => void,
) {
  const next: UserStatus = isActive ? "inactive" : "active";
  try {
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) throw new Error(await readError(res));
    toast.success(
      isActive
        ? `${user.username} deactivated.`
        : `${user.username} activated.`,
    );
    refresh();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to update status.");
  }
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function UsersTableSkeleton() {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead>User</TableHead>
            <TableHead>Employee</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last login</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 6 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-2.5 w-40" />
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Skeleton className="h-3 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-16 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-3 w-28" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-3 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-8 w-8 rounded-md" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / Edit dialog
// ---------------------------------------------------------------------------
interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  user?: UserListItem | null;
}

function UserFormDialog({ open, onOpenChange, mode, user }: UserFormDialogProps) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<UserStatus>("active");
  const [employeeId, setEmployeeId] = useState<string>("__none__");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);

  // Pre-fill form when editing
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && user) {
      setEmail(user.email);
      setUsername(user.username);
      setPassword("");
      setStatus(user.status);
      setEmployeeId(user.employee?.id ?? "__none__");
      setSelectedRoles(user.roles.map((r) => r.id));
    } else {
      setEmail("");
      setUsername("");
      setPassword("");
      setStatus("active");
      setEmployeeId("__none__");
      setSelectedRoles([]);
    }
  }, [open, mode, user]);

  // Fetch employees (when dialog opens) — include the currently linked one
  // for edit mode so it shows up in the dropdown.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        if (mode === "edit" && user?.employee?.id) {
          params.set("includeEmployeeId", user.employee.id);
        }
        const res = await fetch(`/api/users/employees?${params.toString()}`);
        if (!res.ok) throw new Error(await readError(res));
        const data = await res.json();
        if (!cancelled) setEmployees(data.items ?? []);
      } catch {
        if (!cancelled) setEmployees([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, user]);

  // Fetch roles (when dialog opens)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/users/roles`);
        if (!res.ok) throw new Error(await readError(res));
        const data = await res.json();
        if (!cancelled) setRoles(data.items ?? []);
      } catch {
        if (!cancelled) setRoles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const isEdit = mode === "edit";
  const valid =
    email.trim().length > 0 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) &&
    username.trim().length >= 3 &&
    (!isEdit ? password.length >= 8 : password.length === 0 || password.length >= 8);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        email: email.trim().toLowerCase(),
        username: username.trim(),
        roleIds: selectedRoles,
        status,
        employeeId: employeeId === "__none__" ? null : employeeId,
      };
      if (!isEdit || password.length > 0) {
        payload.password = password;
      }

      const url = isEdit ? `/api/users/${user!.id}` : "/api/users";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readError(res));
      toast.success(isEdit ? "User updated." : "User created.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save user.");
    } finally {
      setSaving(false);
    }
  }

  const title = isEdit ? "Edit user" : "Create user";
  const description = isEdit
    ? "Update account details, employee link, or roles."
    : "Add a new staff account and assign roles.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@lightworld.tech"
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-username">Username</Label>
              <Input
                id="user-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. j.doe"
                autoComplete="username"
                required
                minLength={3}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="user-password">
              Password{" "}
              <span className="text-xs font-normal text-muted-foreground">
                {isEdit
                  ? "(leave blank to keep current)"
                  : "(min. 8 characters)"}
              </span>
            </Label>
            <Input
              id="user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? "••••••••" : "Set a strong password"}
              autoComplete={isEdit ? "new-password" : "new-password"}
              required={!isEdit}
              minLength={isEdit ? undefined : 8}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="user-employee">Employee link</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger id="user-employee" className="w-full">
                  <SelectValue placeholder="No employee linked" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No employee —</SelectItem>
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.fullName}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({emp.employeeId}
                        {emp.departmentName ? ` · ${emp.departmentName}` : ""})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as UserStatus)}>
                <SelectTrigger id="user-status" className="w-full">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Roles multi-select */}
          <div className="space-y-1.5">
            <Label>Roles</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between font-normal"
                  role="combobox"
                  aria-label="Select roles"
                >
                  <span className="truncate text-left">
                    {selectedRoles.length === 0
                      ? "No roles assigned"
                      : `${selectedRoles.length} role${
                          selectedRoles.length === 1 ? "" : "s"
                        } selected`}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <div className="max-h-64 overflow-auto p-1">
                  {roles.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-muted-foreground">
                      No roles available.
                    </p>
                  ) : (
                    roles.map((r) => {
                      const checked = selectedRoles.includes(r.id);
                      return (
                        <label
                          key={r.id}
                          htmlFor={`role-${r.id}`}
                          className="flex cursor-pointer items-start gap-2.5 rounded-sm px-2 py-2 text-sm hover:bg-accent"
                        >
                          <Checkbox
                            id={`role-${r.id}`}
                            checked={checked}
                            onCheckedChange={(c) => {
                              if (c) {
                                setSelectedRoles((prev) =>
                                  prev.includes(r.id) ? prev : [...prev, r.id],
                                );
                              } else {
                                setSelectedRoles((prev) =>
                                  prev.filter((id) => id !== r.id),
                                );
                              }
                            }}
                            className="mt-0.5"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">
                              {r.displayName || r.name}
                              {r.isSystem && (
                                <Badge
                                  variant="outline"
                                  className="ml-1.5 h-4 px-1 text-[9px] uppercase"
                                >
                                  System
                                </Badge>
                              )}
                            </span>
                            {r.description && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {r.description}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Save changes" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Manage Roles dialog
// ---------------------------------------------------------------------------
function RolesDialog({
  user,
  onOpenChange,
}: {
  user: UserListItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [rolesRes, currentRes] = await Promise.all([
          fetch(`/api/users/roles`),
          fetch(`/api/users/${user.id}/roles`),
        ]);
        if (!rolesRes.ok) throw new Error(await readError(rolesRes));
        const rolesData = await rolesRes.json();
        const currentData = currentRes.ok ? await currentRes.json() : { items: [] };
        if (!cancelled) {
          setRoles(rolesData.items ?? []);
          setSelected(
            ((currentData.items ?? []) as Array<{ id: string }>).map((r) => r.id),
          );
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load roles.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleSave() {
    if (!user || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${user.id}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleIds: selected }),
      });
      if (!res.ok) throw new Error(await readError(res));
      toast.success("Role assignments updated.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update roles.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Manage roles</DialogTitle>
          <DialogDescription>
            {user
              ? `Choose which roles ${user.username} (${user.email}) should hold. Replaces the current assignment.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto rounded-md border">
          {loading ? (
            <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading roles…
            </div>
          ) : roles.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No roles are defined in the system yet.
            </p>
          ) : (
            <ul className="divide-y">
              {roles.map((r) => {
                const checked = selected.includes(r.id);
                return (
                  <li key={r.id}>
                    <label
                      htmlFor={`roles-dialog-${r.id}`}
                      className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-accent"
                    >
                      <Checkbox
                        id={`roles-dialog-${r.id}`}
                        checked={checked}
                        onCheckedChange={(c) => {
                          if (c) {
                            setSelected((p) => (p.includes(r.id) ? p : [...p, r.id]));
                          } else {
                            setSelected((p) => p.filter((id) => id !== r.id));
                          }
                        }}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">
                            {r.displayName || r.name}
                          </span>
                          {r.isSystem && (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 text-[9px] uppercase"
                            >
                              System
                            </Badge>
                          )}
                        </div>
                        {r.description && (
                          <p className="truncate text-xs text-muted-foreground">
                            {r.description}
                          </p>
                        )}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reset Password dialog
// ---------------------------------------------------------------------------
function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: UserListItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) {
      setPassword("");
      setConfirm("");
    }
  }, [user]);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;
  const valid =
    password.length >= 8 && confirm.length >= 8 && password === confirm;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !valid || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error(await readError(res));
      toast.success("Password reset. The user can now sign in with the new password.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            {user
              ? `Set a new password for ${user.username} (${user.email}). This will clear any active lockout.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              autoComplete="new-password"
              required
              minLength={8}
              aria-invalid={tooShort}
            />
            {tooShort && (
              <p className="text-xs text-destructive">
                Password must be at least 8 characters.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reset-confirm">Confirm password</Label>
            <Input
              id="reset-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter the new password"
              autoComplete="new-password"
              required
              minLength={8}
              aria-invalid={mismatch}
            />
            {mismatch && (
              <p className="text-xs text-destructive">Passwords do not match.</p>
            )}
          </div>
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
