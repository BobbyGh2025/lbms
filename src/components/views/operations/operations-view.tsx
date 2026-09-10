"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ClipboardList, Plus, Loader2, ChevronRight, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface TaskItem {
  id: string;
  taskNumber: string;
  title: string;
  projectName: string | null;
  customerName: string | null;
  assignedEmployeeName: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  _count?: { checklists: number };
}

const STATUS_BADGE: Record<string, string> = {
  todo: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  in_progress: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  on_hold: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  completed: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  cancelled: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const PRIORITY_BADGE: Record<string, string> = {
  low: "bg-zinc-500/10 text-zinc-600",
  medium: "bg-sky-500/10 text-sky-600",
  high: "bg-amber-500/10 text-amber-600",
  critical: "bg-rose-500/10 text-rose-600",
};

function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || status === "completed" || status === "cancelled") return false;
  return new Date(dueDate) < new Date();
}

export function OperationsView() {
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [projects, setProjects] = useState<{id:string;name:string}[]>([]);
  const [employees, setEmployees] = useState<{id:string;name:string}[]>([]);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);
      params.set("pageSize", "50");
      const res = await fetch(`/api/tasks?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [search, statusFilter, priorityFilter]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    if (!createOpen) return;
    (async () => {
      try {
        const [pRes, eRes] = await Promise.all([
          fetch("/api/projects?pageSize=100"),
          fetch("/api/staff?pageSize=100"),
        ]);
        const p = pRes.ok ? await pRes.json() : { items: [] };
        const e = eRes.ok ? await eRes.json() : { items: [] };
        setProjects((p.items ?? []).map((x: any) => ({ id: x.id, name: x.name })));
        setEmployees((e.items ?? []).map((x: any) => ({ id: x.id, name: x.fullName || x.employeeId })));
      } catch { /* silent */ }
    })();
  }, [createOpen]);

  function viewProfile(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "task-profile");
    params.set("id", id);
    router.push(`?${params.toString()}`);
  }

  async function handleSubmit() {
    if (!title.trim()) { toast.error("Title is required."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          projectId: projectId || undefined,
          assignedEmployeeId: assignedEmployeeId || undefined,
          priority,
          dueDate: dueDate || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create task.");
      }
      const created = await res.json();
      toast.success(`Task created: ${created.taskNumber}`);
      setCreateOpen(false);
      setTitle(""); setDescription(""); setProjectId(""); setAssignedEmployeeId("");
      setPriority("medium"); setDueDate("");
      fetchTasks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create task.");
    } finally {
      setSaving(false);
    }
  }

  function fmt(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "2-digit" });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Operations"
        description="Track and manage operational tasks, assignments, and deadlines."
        action={can("operations", "create") ? (
          <Button data-testid="task-trigger" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New Task
          </Button>
        ) : null}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by title or number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="todo">To Do</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No tasks found" description="Create your first operational task to get started." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((t) => {
                    const overdue = isOverdue(t.dueDate, t.status);
                    return (
                      <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => viewProfile(t.id)}>
                        <TableCell className="font-mono text-xs">{t.taskNumber}</TableCell>
                        <TableCell className="text-sm font-medium">{t.title}</TableCell>
                        <TableCell className="text-xs">{t.projectName || "—"}</TableCell>
                        <TableCell className="text-xs">{t.assignedEmployeeName || "—"}</TableCell>
                        <TableCell><Badge variant="outline" className={STATUS_BADGE[t.status] ?? ""}>{t.status.replace("_", " ")}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className={PRIORITY_BADGE[t.priority] ?? ""}>{t.priority}</Badge></TableCell>
                        <TableCell className="text-xs">
                          <span className={overdue ? "text-rose-600 font-medium" : ""}>
                            {fmt(t.dueDate)}
                          </span>
                          {overdue && <AlertCircle className="inline h-3 w-3 ml-1 text-rose-600" />}
                        </TableCell>
                        <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
            <DialogDescription>Create an operational task.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Configure server for deployment" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-desc">Description</Label>
              <Textarea id="task-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Project (optional)</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Assignee</Label>
                <Select value={assignedEmployeeId} onValueChange={setAssignedEmployeeId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (<SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-due">Due Date</Label>
                <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="button" data-testid="task-submit" onClick={handleSubmit} disabled={saving || !title.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
