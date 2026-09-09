"use client";

// ============================================================================
// LBMS Roles & Permissions view
// ----------------------------------------------------------------------------
// - PageHeader with "New Role" button (gated on roles:create)
// - Grid of role cards (displayName, code, description, system badge, counts,
//   action buttons)
// - Permission Matrix Dialog (modules × actions checkbox grid, MD row read-only)
// - New/Edit Role Dialog (name + displayName + description)
// - Delete confirmation via ConfirmDialog
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  Plus,
  Pencil,
  KeyRound,
  Trash2,
  Loader2,
  Users as UsersIcon,
  Lock,
  Crown,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useAuth } from "@/hooks/use-auth";
import {
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
} from "@/lib/permissions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PermissionItem {
  id: string;
  module: string;
  action: string;
}
interface RoleItem {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  permissions: PermissionItem[];
  _count: { users: number };
}
interface PermissionModule {
  module: string;
  permissions: PermissionItem[];
}

// Friendly labels for module codes (mirror prisma/seed.ts).
const MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  finance: "Finance",
  accounts: "Cash & Bank",
  budgets: "Budgets",
  receivables: "Receivables",
  payables: "Payables",
  staff: "Staff",
  departments: "Departments",
  tasks: "Tasks",
  customers: "Customers",
  suppliers: "Suppliers",
  projects: "Projects",
  pipeline: "Pipeline",
  operations: "Operations",
  decisions: "MD Decisions",
  approvals: "Approvals",
  assets: "Assets",
  documents: "Documents",
  reports: "Reports",
  settings: "Settings",
  users: "Users",
  roles: "Roles",
  audit: "Audit",
  notifications: "Notifications",
  backup: "Backup",
};

function moduleLabel(m: string): string {
  return MODULE_LABELS[m] ?? m;
}

// ===========================================================================
// Main view
// ===========================================================================
export function RolesView() {
  const { can, isLoading: authLoading } = useAuth();
  const canCreate = can("roles", "create");
  const canEdit = can("roles", "edit");
  const canDelete = can("roles", "delete");

  const [roles, setRoles] = useState<RoleItem[] | null>(null);
  const [permissionModules, setPermissionModules] = useState<PermissionModule[]>([]);
  const [loading, setLoading] = useState(true);

  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null);
  const [permissionsRole, setPermissionsRole] = useState<RoleItem | null>(null);
  const [deleteRole, setDeleteRole] = useState<RoleItem | null>(null);

  const loadRoles = useCallback(async () => {
    try {
      const res = await fetch("/api/roles", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setRoles(json.items as RoleItem[]);
    } catch {
      toast.error("Failed to load roles.");
      setRoles([]);
    }
  }, []);

  const loadPermissions = useCallback(async () => {
    try {
      const res = await fetch("/api/permissions", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setPermissionModules(json.modules as PermissionModule[]);
    } catch {
      // Non-blocking — matrix will simply show no permissions available.
      setPermissionModules([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([loadRoles(), loadPermissions()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRoles, loadPermissions]);

  function openCreate() {
    setEditingRole(null);
    setRoleDialogOpen(true);
  }
  function openEdit(role: RoleItem) {
    setEditingRole(role);
    setRoleDialogOpen(true);
  }

  async function onRoleSaved() {
    setRoleDialogOpen(false);
    setEditingRole(null);
    await loadRoles();
  }

  async function onPermissionsSaved() {
    setPermissionsRole(null);
    await loadRoles();
  }

  async function handleDelete() {
    if (!deleteRole) return;
    try {
      const res = await fetch(`/api/roles/${deleteRole.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to delete role.");
      }
      toast.success(`Role '${deleteRole.displayName}' deleted.`);
      setDeleteRole(null);
      await loadRoles();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to delete role.";
      toast.error(msg);
      throw e; // keep ConfirmDialog open so user can retry
    }
  }

  const showSkeleton = loading || authLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles & Permissions"
        description="Manage security roles and the module permissions assigned to each role."
        action={
          canCreate ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> New Role
            </Button>
          ) : undefined
        }
      />

      {showSkeleton ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : !roles || roles.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No roles yet"
          description="Create your first role to assign permissions and users."
          action={
            canCreate ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" /> New Role
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              canEdit={canEdit}
              canDelete={canDelete}
              onEdit={() => openEdit(role)}
              onEditPermissions={() => setPermissionsRole(role)}
              onDelete={() => setDeleteRole(role)}
            />
          ))}
        </div>
      )}

      {/* New / Edit Role Dialog */}
      <RoleFormDialog
        open={roleDialogOpen}
        onOpenChange={(o) => {
          setRoleDialogOpen(o);
          if (!o) setEditingRole(null);
        }}
        role={editingRole}
        onSaved={onRoleSaved}
      />

      {/* Permission Matrix Dialog */}
      <PermissionMatrixDialog
        role={permissionsRole}
        modules={permissionModules}
        onClose={() => setPermissionsRole(null)}
        onSaved={onPermissionsSaved}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteRole}
        onOpenChange={(o) => !o && setDeleteRole(null)}
        trigger={null}
        title="Delete role?"
        description={
          deleteRole
            ? `This will permanently delete '${deleteRole.displayName}' (code: ${deleteRole.name}). The role currently has ${deleteRole._count.users} user(s) assigned.`
            : ""
        }
        confirmLabel="Delete role"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ===========================================================================
// Role card
// ===========================================================================
interface RoleCardProps {
  role: RoleItem;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onEditPermissions: () => void;
  onDelete: () => void;
}

function RoleCard({
  role,
  canEdit,
  canDelete,
  onEdit,
  onEditPermissions,
  onDelete,
}: RoleCardProps) {
  const isMD = role.name === "md";
  const hasUsers = role._count.users > 0;

  return (
    <Card className="flex flex-col">
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 text-base">
              {isMD && <Crown className="h-4 w-4 text-amber-500" />}
              <span className="truncate">{role.displayName}</span>
            </CardTitle>
            <CardDescription className="font-mono text-xs">{role.name}</CardDescription>
          </div>
          {role.isSystem ? (
            <Badge variant="secondary" className="shrink-0 gap-1">
              <Lock className="h-3 w-3" /> System
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0">
              Custom
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <p className="line-clamp-3 min-h-[2.5rem] text-sm text-muted-foreground">
          {role.description ?? "No description provided."}
        </p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-1 text-muted-foreground">
              <UsersIcon className="h-3 w-3" /> Users
            </div>
            <div className="text-base font-semibold">{role._count.users}</div>
          </div>
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-1 text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Permissions
            </div>
            <div className="text-base font-semibold">
              {isMD ? "All" : role.permissions.length}
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onEditPermissions}
          disabled={!canEdit}
        >
          <KeyRound className="h-3.5 w-3.5" /> Permissions
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit} disabled={!canEdit}>
          <Pencil className="h-3.5 w-3.5" /> Details
        </Button>
        {!role.isSystem && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={!canDelete}
            title={hasUsers ? "Reassign users first" : "Delete role"}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

// ===========================================================================
// Role create / edit form dialog
// ===========================================================================
interface RoleFormDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  role: RoleItem | null;
  onSaved: () => void;
}

function RoleFormDialog({ open, onOpenChange, role, onSaved }: RoleFormDialogProps) {
  const isEdit = !!role;
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(role?.name ?? "");
      setDisplayName(role?.displayName ?? "");
      setDescription(role?.description ?? "");
    }
  }, [open, role]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedDisplay = displayName.trim();
    if (!trimmedDisplay) {
      toast.error("Display name is required.");
      return;
    }
    if (!isEdit) {
      const trimmedName = name.trim();
      if (!/^[a-z][a-z0-9_]*$/.test(trimmedName)) {
        toast.error(
          "Role code must be lowercase, no spaces, starting with a letter.",
        );
        return;
      }
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        displayName: trimmedDisplay,
        description: description.trim() || null,
      };
      if (!isEdit) {
        payload.name = name.trim();
        payload.permissionKeys = [];
      }

      const res = isEdit
        ? await fetch(`/api/roles/${role!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/roles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to save role.");
      }
      toast.success(isEdit ? "Role updated." : "Role created.");
      onSaved();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save role.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  const nameLocked = isEdit && role?.isSystem;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Role" : "New Role"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the role's display name and description."
              : "Define a new security role. You can assign permissions after creating it."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="role-name">Role code</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. sales_manager"
              disabled={nameLocked}
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              {nameLocked
                ? "System roles cannot be renamed."
                : "Lowercase, no spaces. Used as the role's identifier in code."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-display">Display name</Label>
            <Input
              id="role-display"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Sales Manager"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-desc">Description</Label>
            <Textarea
              id="role-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this role do?"
              rows={3}
            />
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
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Save changes" : "Create role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Permission matrix dialog
// ===========================================================================
interface MatrixDialogProps {
  role: RoleItem | null;
  modules: PermissionModule[];
  onClose: () => void;
  onSaved: () => void;
}

function PermissionMatrixDialog({
  role,
  modules,
  onClose,
  onSaved,
}: MatrixDialogProps) {
  const open = !!role;
  const isMD = role?.name === "md";

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load role's current permission keys whenever a new role is opened.
  useEffect(() => {
    if (!role) {
      setSelected(new Set());
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/roles/${role.id}/permissions`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!cancelled) setSelected(new Set(json.permissionKeys as string[]));
      } catch {
        if (!cancelled) toast.error("Failed to load role permissions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  function toggle(module: string, action: string) {
    if (isMD) return;
    const key = `${module}:${action}`;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllView() {
    if (isMD) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const m of PERMISSION_MODULES) next.add(`${m}:view`);
      return next;
    });
  }

  function clearAll() {
    if (isMD) return;
    setSelected(new Set());
  }

  async function handleSave() {
    if (!role || isMD) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/roles/${role.id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionKeys: Array.from(selected) }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to save permissions.");
      }
      toast.success("Permissions updated.");
      onSaved();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save permissions.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Edit permissions — {role?.displayName}
          </DialogTitle>
          <DialogDescription>
            {isMD
              ? "MD has full access to every module. This cannot be changed."
              : "Toggle the module permissions assigned to this role. Changes are saved on Save."}
          </DialogDescription>
        </DialogHeader>

        {isMD && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <Lock className="mr-1 inline h-3 w-3" /> MD has full access
          </div>
        )}

        {!isMD && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={selectAllView}
              disabled={loading}
            >
              Select all view
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={clearAll}
              disabled={loading}
            >
              Clear all
            </Button>
            <span className="ml-auto text-muted-foreground">
              {selected.size} permission{selected.size === 1 ? "" : "s"} selected
            </span>
          </div>
        )}

        <ScrollArea className="max-h-[55vh] flex-1 overflow-auto rounded-md border">
          <div className="min-w-[640px]">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  <th className="border-b px-3 py-2 text-left font-medium text-muted-foreground">
                    Module
                  </th>
                  {PERMISSION_ACTIONS.map((a) => (
                    <th
                      key={a}
                      className="border-b px-3 py-2 text-center font-medium capitalize text-muted-foreground"
                    >
                      {a}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_MODULES.map((module) => {
                  const modEntry = modules.find((m) => m.module === module);
                  return (
                    <tr key={module} className="hover:bg-muted/30">
                      <td className="border-b px-3 py-2 font-medium">
                        {moduleLabel(module)}
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                          {module}
                        </span>
                      </td>
                      {PERMISSION_ACTIONS.map((action) => {
                        const perm = modEntry?.permissions.find(
                          (p) => p.action === action,
                        );
                        const key = `${module}:${action}`;
                        const checked =
                          isMD || (perm ? selected.has(key) : false);
                        return (
                          <td
                            key={action}
                            className="border-b px-3 py-2 text-center"
                          >
                            <Checkbox
                              checked={checked}
                              disabled={isMD || !perm || loading}
                              onCheckedChange={() => toggle(module, action)}
                              aria-label={`${moduleLabel(module)} — ${action}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ScrollArea>

        <DialogFooter className="mt-1">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || isMD || loading}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
