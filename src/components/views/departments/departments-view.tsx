"use client";

// ============================================================================
// LBMS Departments & Positions View
// ----------------------------------------------------------------------------
// Two-pane master-detail layout:
//   - Left pane: list of departments (cards) with code badge, position count,
//     employee count and status. Selectable.
//   - Right pane: when a department is selected, shows its positions in a
//     table with title, description, employee count, status and actions.
// Both departments and positions support create / edit dialogs and delete
// via ConfirmDialog. Uses sonner toasts and useAuth() for permissions.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  Briefcase,
  Users,
  Plus,
  Pencil,
  Trash2,
  Search,
  Loader2,
  ChevronLeft,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DepartmentListItem = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: string;
  createdAt: string;
  _count: { positions: number; employees: number };
};

type DepartmentDetail = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: string;
  createdAt: string;
  positions: Array<PositionRow>;
  _count: { positions: number; employees: number };
};

type PositionRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  _count: { employees: number };
};

type DepartmentOption = { id: string; name: string; code: string | null };

type DeptFormState = {
  name: string;
  code: string;
  description: string;
  status: string;
};

type PositionFormState = {
  title: string;
  departmentId: string;
  description: string;
  status: string;
};

const EMPTY_DEPT_FORM: DeptFormState = {
  name: "",
  code: "",
  description: "",
  status: "active",
};

const EMPTY_POS_FORM: PositionFormState = {
  title: "",
  departmentId: "",
  description: "",
  status: "active",
};

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DepartmentsView() {
  const { can } = useAuth();
  const canCreate = can("departments", "create");
  const canEdit = can("departments", "edit");
  const canDelete = can("departments", "delete");

  const [departments, setDepartments] = useState<DepartmentListItem[]>([]);
  const [loadingDepts, setLoadingDepts] = useState(true);
  const [search, setSearch] = useState("");

  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [selectedDept, setSelectedDept] = useState<DepartmentDetail | null>(null);
  const [loadingDept, setLoadingDept] = useState(false);

  // Department dialog state
  const [deptDialogOpen, setDeptDialogOpen] = useState(false);
  const [deptEditing, setDeptEditing] = useState<DepartmentListItem | null>(null);
  const [deptForm, setDeptForm] = useState<DeptFormState>(EMPTY_DEPT_FORM);
  const [savingDept, setSavingDept] = useState(false);

  // Position dialog state
  const [posDialogOpen, setPosDialogOpen] = useState(false);
  const [posEditing, setPosEditing] = useState<PositionRow | null>(null);
  const [posForm, setPosForm] = useState<PositionFormState>(EMPTY_POS_FORM);
  const [savingPos, setSavingPos] = useState(false);

  // Delete confirmation state (controlled)
  const [deleteDeptId, setDeleteDeptId] = useState<string | null>(null);
  const [deletePosId, setDeletePosId] = useState<string | null>(null);

  // Mobile back-to-list toggle. On small screens the detail pane replaces
  // the list when a department is selected.
  const [mobileShowDetail, setMobileShowDetail] = useState(false);

  // --- Data fetching -------------------------------------------------------

  const fetchDepartments = useCallback(async () => {
    setLoadingDepts(true);
    try {
      const res = await fetch("/api/departments");
      if (!res.ok) throw new Error("bad response");
      const json: { items: DepartmentListItem[] } = await res.json();
      setDepartments(json.items);
    } catch {
      toast.error("Failed to load departments.");
    } finally {
      setLoadingDepts(false);
    }
  }, []);

  const fetchDeptDetail = useCallback(async () => {
    if (!selectedDeptId) {
      setSelectedDept(null);
      return;
    }
    setLoadingDept(true);
    try {
      const res = await fetch(`/api/departments/${selectedDeptId}`);
      if (!res.ok) throw new Error("bad response");
      const json: DepartmentDetail = await res.json();
      setSelectedDept(json);
    } catch {
      toast.error("Failed to load department details.");
      setSelectedDept(null);
    } finally {
      setLoadingDept(false);
    }
  }, [selectedDeptId]);

  useEffect(() => {
    void fetchDepartments();
  }, [fetchDepartments]);

  useEffect(() => {
    void fetchDeptDetail();
  }, [fetchDeptDetail]);

  // --- Derived state ------------------------------------------------------

  const filteredDepartments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.code ? d.code.toLowerCase().includes(q) : false),
    );
  }, [departments, search]);

  const departmentOptions: DepartmentOption[] = useMemo(
    () =>
      departments
        .filter((d) => d.status === "active")
        .map((d) => ({ id: d.id, name: d.name, code: d.code })),
    [departments],
  );

  const totals = useMemo(() => {
    const totalDepartments = departments.length;
    const totalPositions = departments.reduce((s, d) => s + d._count.positions, 0);
    const totalEmployees = departments.reduce((s, d) => s + d._count.employees, 0);
    return { totalDepartments, totalPositions, totalEmployees };
  }, [departments]);

  // --- Selection helpers ---------------------------------------------------

  function selectDepartment(id: string) {
    setSelectedDeptId(id);
    setMobileShowDetail(true);
  }

  function backToList() {
    setMobileShowDetail(false);
  }

  // --- Department CRUD -----------------------------------------------------

  function openCreateDept() {
    setDeptEditing(null);
    setDeptForm(EMPTY_DEPT_FORM);
    setDeptDialogOpen(true);
  }

  function openEditDept(d: DepartmentListItem) {
    setDeptEditing(d);
    setDeptForm({
      name: d.name,
      code: d.code ?? "",
      description: d.description ?? "",
      status: d.status,
    });
    setDeptDialogOpen(true);
  }

  async function submitDept() {
    const name = deptForm.name.trim();
    if (!name) {
      toast.error("Department name is required.");
      return;
    }
    setSavingDept(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        code: deptForm.code.trim() || undefined,
        description: deptForm.description.trim() || undefined,
      };
      if (deptEditing) payload.status = deptForm.status;

      const url = deptEditing ? `/api/departments/${deptEditing.id}` : "/api/departments";
      const method = deptEditing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error ?? "Failed to save department.");
        return;
      }
      toast.success(deptEditing ? "Department updated." : "Department created.");
      setDeptDialogOpen(false);
      await fetchDepartments();
      if (deptEditing && selectedDeptId === deptEditing.id) {
        await fetchDeptDetail();
      }
    } catch {
      toast.error("Network error while saving department.");
    } finally {
      setSavingDept(false);
    }
  }

  async function deleteDept(id: string) {
    try {
      const res = await fetch(`/api/departments/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error ?? "Failed to delete department.");
        return;
      }
      toast.success("Department deleted.");
      if (selectedDeptId === id) {
        setSelectedDeptId(null);
        setSelectedDept(null);
        setMobileShowDetail(false);
      }
      await fetchDepartments();
    } catch {
      toast.error("Network error while deleting department.");
    }
  }

  // --- Position CRUD -------------------------------------------------------

  function openCreatePos() {
    if (!selectedDept) return;
    setPosEditing(null);
    setPosForm({
      title: "",
      departmentId: selectedDept.id,
      description: "",
      status: "active",
    });
    setPosDialogOpen(true);
  }

  function openEditPos(p: PositionRow) {
    setPosEditing(p);
    setPosForm({
      title: p.title,
      departmentId: selectedDept?.id ?? "",
      description: p.description ?? "",
      status: p.status,
    });
    setPosDialogOpen(true);
  }

  async function submitPos() {
    const title = posForm.title.trim();
    if (!title) {
      toast.error("Position title is required.");
      return;
    }
    setSavingPos(true);
    try {
      const payload: Record<string, unknown> = {
        title,
        description: posForm.description.trim() || undefined,
        departmentId: posForm.departmentId || undefined,
      };
      if (posEditing) payload.status = posForm.status;

      const url = posEditing ? `/api/positions/${posEditing.id}` : "/api/positions";
      const method = posEditing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error ?? "Failed to save position.");
        return;
      }
      toast.success(posEditing ? "Position updated." : "Position created.");
      setPosDialogOpen(false);
      await Promise.all([fetchDeptDetail(), fetchDepartments()]);
    } catch {
      toast.error("Network error while saving position.");
    } finally {
      setSavingPos(false);
    }
  }

  async function deletePos(id: string) {
    try {
      const res = await fetch(`/api/positions/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error ?? "Failed to delete position.");
        return;
      }
      toast.success("Position deleted.");
      await Promise.all([fetchDeptDetail(), fetchDepartments()]);
    } catch {
      toast.error("Network error while deleting position.");
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-5">
      <PageHeader
        title="Departments & Positions"
        description="Configure your organisational structure — departments, positions, and how they relate."
        action={
          canCreate ? (
            <Button onClick={openCreateDept}>
              <Plus className="size-4" /> New Department
            </Button>
          ) : undefined
        }
      />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatChip
          icon={Building2}
          label="Departments"
          value={totals.totalDepartments}
          loading={loadingDepts}
        />
        <StatChip
          icon={Briefcase}
          label="Positions"
          value={totals.totalPositions}
          loading={loadingDepts}
        />
        <StatChip
          icon={Users}
          label="Employees"
          value={totals.totalEmployees}
          loading={loadingDepts}
        />
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search departments by name or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left pane — departments list */}
        <div className={cn("lg:col-span-1", mobileShowDetail && "hidden lg:block")}>
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Departments ({filteredDepartments.length})
                </p>
              </div>
              <div className="max-h-[65vh] overflow-y-auto p-2">
                {loadingDepts ? (
                  <DeptListSkeleton />
                ) : filteredDepartments.length === 0 ? (
                  <div className="p-3">
                    <EmptyState
                      icon={Building2}
                      title={search ? "No matching departments" : "No departments yet"}
                      description={
                        search
                          ? "Try a different search term."
                          : "Create your first department to get started."
                      }
                      action={
                        canCreate && !search ? (
                          <Button size="sm" onClick={openCreateDept}>
                            <Plus className="size-4" /> Add Department
                          </Button>
                        ) : undefined
                      }
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {filteredDepartments.map((d) => {
                      const isSelected = selectedDeptId === d.id;
                      return (
                        <div
                          key={d.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => selectDepartment(d.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectDepartment(d.id);
                            }
                          }}
                          className={cn(
                            "group cursor-pointer rounded-md border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isSelected && "border-primary/30 bg-accent",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-medium">{d.name}</p>
                                {d.code && (
                                  <Badge
                                    variant="secondary"
                                    className="h-5 shrink-0 px-1.5 font-mono text-[10px]"
                                  >
                                    {d.code}
                                  </Badge>
                                )}
                              </div>
                              {d.description && (
                                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                                  {d.description}
                                </p>
                              )}
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                  <Briefcase className="size-3" />
                                  {d._count.positions} pos
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Users className="size-3" />
                                  {d._count.employees} emp
                                </span>
                                <StatusBadge status={d.status} />
                              </div>
                            </div>
                            <div
                              className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {canEdit && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-7"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditDept(d);
                                  }}
                                  aria-label="Edit department"
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                              )}
                              {canDelete && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-7 text-rose-600 hover:text-rose-700"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteDeptId(d.id);
                                  }}
                                  aria-label="Delete department"
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right pane — positions */}
        <div className={cn("lg:col-span-2", !mobileShowDetail && "hidden lg:block")}>
          <Card className="min-h-[60vh]">
            <CardContent className="p-0">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <div className="min-w-0 flex-1">
                  {selectedDept ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 lg:hidden"
                          onClick={backToList}
                          aria-label="Back to departments"
                        >
                          <ChevronLeft className="size-4" />
                        </Button>
                        <p className="truncate text-sm font-semibold">{selectedDept.name}</p>
                        {selectedDept.code && (
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            {selectedDept.code}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 pl-1 text-xs text-muted-foreground lg:pl-0">
                        {selectedDept._count.positions} position
                        {selectedDept._count.positions !== 1 ? "s" : ""} ·{" "}
                        {selectedDept._count.employees} employee
                        {selectedDept._count.employees !== 1 ? "s" : ""}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm font-medium text-muted-foreground">Positions</p>
                  )}
                </div>
                {selectedDept && canCreate && (
                  <Button size="sm" onClick={openCreatePos}>
                    <Plus className="size-4" /> Add Position
                  </Button>
                )}
              </div>

              <div className="p-4">
                {!selectedDeptId ? (
                  <EmptyState
                    icon={Briefcase}
                    title="Select a department"
                    description="Choose a department from the list to view and manage its positions."
                  />
                ) : loadingDept ? (
                  <PositionTableSkeleton />
                ) : !selectedDept ? (
                  <EmptyState
                    icon={Briefcase}
                    title="Department not found"
                    description="It may have been deleted. Pick another from the list."
                  />
                ) : selectedDept.positions.length === 0 ? (
                  <EmptyState
                    icon={Briefcase}
                    title="No positions yet"
                    description="Add the first position for this department."
                    action={
                      canCreate ? (
                        <Button size="sm" onClick={openCreatePos}>
                          <Plus className="size-4" /> Add Position
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead className="hidden w-[40%] sm:table-cell">
                          Description
                        </TableHead>
                        <TableHead className="text-center">Employees</TableHead>
                        <TableHead>Status</TableHead>
                        {(canEdit || canDelete) && (
                          <TableHead className="w-px text-right">Actions</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedDept.positions.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.title}</TableCell>
                          <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                            {p.description ?? <span className="italic">—</span>}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="font-mono">
                              {p._count.employees}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={p.status} />
                          </TableCell>
                          {(canEdit || canDelete) && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-0.5">
                                {canEdit && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="size-7"
                                    onClick={() => openEditPos(p)}
                                    aria-label="Edit position"
                                  >
                                    <Pencil className="size-3.5" />
                                  </Button>
                                )}
                                {canDelete && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="size-7 text-rose-600 hover:text-rose-700"
                                    onClick={() => setDeletePosId(p.id)}
                                    aria-label="Delete position"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Department Dialog */}
      <Dialog open={deptDialogOpen} onOpenChange={setDeptDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deptEditing ? "Edit Department" : "New Department"}
            </DialogTitle>
            <DialogDescription>
              {deptEditing
                ? "Update the department's details below."
                : "Create a new department to organise your staff."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dept-name">
                Name <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="dept-name"
                value={deptForm.name}
                onChange={(e) =>
                  setDeptForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="e.g. Engineering"
                maxLength={100}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dept-code">Code</Label>
              <Input
                id="dept-code"
                value={deptForm.code}
                onChange={(e) =>
                  setDeptForm((f) => ({
                    ...f,
                    code: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="e.g. ENG"
                maxLength={20}
              />
              <p className="text-[11px] text-muted-foreground">
                Short unique code (optional).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dept-desc">Description</Label>
              <Textarea
                id="dept-desc"
                value={deptForm.description}
                onChange={(e) =>
                  setDeptForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="What does this department do?"
                rows={3}
                maxLength={500}
              />
            </div>
            {deptEditing && (
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={deptForm.status}
                  onValueChange={(v) =>
                    setDeptForm((f) => ({ ...f, status: v }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
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
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeptDialogOpen(false)}
              disabled={savingDept}
            >
              Cancel
            </Button>
            <Button onClick={() => void submitDept()} disabled={savingDept}>
              {savingDept && <Loader2 className="size-4 animate-spin" />}
              {deptEditing ? "Save Changes" : "Create Department"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Position Dialog */}
      <Dialog open={posDialogOpen} onOpenChange={setPosDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {posEditing ? "Edit Position" : "New Position"}
            </DialogTitle>
            <DialogDescription>
              {posEditing
                ? "Update the position's details below."
                : "Create a new position and (optionally) attach it to a department."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pos-title">
                Title <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="pos-title"
                value={posForm.title}
                onChange={(e) =>
                  setPosForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="e.g. Software Engineer"
                maxLength={100}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select
                value={posForm.departmentId}
                onValueChange={(v) =>
                  setPosForm((f) => ({ ...f, departmentId: v }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="— No department —" />
                </SelectTrigger>
                <SelectContent>
                  {departmentOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                      {d.code ? ` (${d.code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Positions can exist without a department.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pos-desc">Description</Label>
              <Textarea
                id="pos-desc"
                value={posForm.description}
                onChange={(e) =>
                  setPosForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Responsibilities, seniority, etc."
                rows={3}
                maxLength={500}
              />
            </div>
            {posEditing && (
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={posForm.status}
                  onValueChange={(v) =>
                    setPosForm((f) => ({ ...f, status: v }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
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
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPosDialogOpen(false)}
              disabled={savingPos}
            >
              Cancel
            </Button>
            <Button onClick={() => void submitPos()} disabled={savingPos}>
              {savingPos && <Loader2 className="size-4 animate-spin" />}
              {posEditing ? "Save Changes" : "Create Position"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Department Confirmation */}
      <ConfirmDialog
        open={!!deleteDeptId}
        onOpenChange={(o) => !o && setDeleteDeptId(null)}
        trigger={null}
        title="Delete department?"
        description="This soft-deletes the department. Departments with active employees or positions cannot be deleted until those are reassigned."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleteDeptId) await deleteDept(deleteDeptId);
          setDeleteDeptId(null);
        }}
      />

      {/* Delete Position Confirmation */}
      <ConfirmDialog
        open={!!deletePosId}
        onOpenChange={(o) => !o && setDeletePosId(null)}
        trigger={null}
        title="Delete position?"
        description="This soft-deletes the position. Positions with active employees cannot be deleted until those employees are reassigned."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deletePosId) await deletePos(deletePosId);
          setDeletePosId(null);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        Active
      </Badge>
    );
  }
  return <Badge variant="secondary">Inactive</Badge>;
}

function StatChip({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3 sm:p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium text-muted-foreground">
            {label}
          </p>
          {loading ? (
            <Skeleton className="mt-1 h-5 w-10" />
          ) : (
            <p className="text-lg font-bold tracking-tight">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DeptListSkeleton() {
  return (
    <div className="space-y-2 p-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-md border p-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-3 w-48" />
          <div className="mt-2 flex gap-3">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PositionTableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
