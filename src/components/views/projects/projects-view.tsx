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
import { FolderKanban, Plus, Loader2, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface ProjectItem {
  id: string;
  projectNumber: string;
  name: string;
  customerName: string | null;
  projectManagerName: string | null;
  status: string;
  priority: string;
  startDate: string | null;
  plannedEndDate: string | null;
  budgetAmount: string;
  estimatedRevenue: string;
  estimatedCost: string;
  _count?: { teamMembers: number; milestones: number };
}

const STATUS_BADGE: Record<string, string> = {
  planning: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
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

function formatMoney(v: string) {
  const n = Number(v);
  if (!isFinite(n) || n === 0) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function ProjectsView() {
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [projectManagerId, setProjectManagerId] = useState("");
  const [priority, setPriority] = useState("medium");
  const [startDate, setStartDate] = useState("");
  const [plannedEndDate, setPlannedEndDate] = useState("");
  const [budget, setBudget] = useState("");
  const [estimatedRevenue, setEstimatedRevenue] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [customers, setCustomers] = useState<{id:string;name:string}[]>([]);
  const [employees, setEmployees] = useState<{id:string;name:string}[]>([]);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("pageSize", "50");
      const res = await fetch(`/api/projects?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [search, statusFilter]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  useEffect(() => {
    if (!createOpen) return;
    (async () => {
      try {
        const [cRes, eRes] = await Promise.all([
          fetch("/api/customers?pageSize=100"),
          fetch("/api/staff?pageSize=100"),
        ]);
        const c = cRes.ok ? await cRes.json() : { items: [] };
        const e = eRes.ok ? await eRes.json() : { items: [] };
        setCustomers((c.items ?? []).map((x: any) => ({ id: x.id, name: x.tradingName || x.legalName || x.customerNumber })));
        setEmployees((e.items ?? []).map((x: any) => ({ id: x.id, name: x.fullName || x.employeeId })));
      } catch { /* silent */ }
    })();
  }, [createOpen]);

  function viewProfile(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "project-profile");
    params.set("id", id);
    router.push(`?${params.toString()}`);
  }

  async function handleSubmit() {
    if (!name.trim()) { toast.error("Project name is required."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          customerId: customerId || undefined,
          projectManagerId: projectManagerId || undefined,
          priority,
          startDate: startDate || undefined,
          plannedEndDate: plannedEndDate || undefined,
          budgetAmount: budget || "0",
          estimatedRevenue: estimatedRevenue || "0",
          estimatedCost: estimatedCost || "0",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create project.");
      }
      const created = await res.json();
      toast.success(`Project created: ${created.projectNumber}`);
      setCreateOpen(false);
      setName(""); setDescription(""); setCustomerId(""); setProjectManagerId("");
      setPriority("medium"); setStartDate(""); setPlannedEndDate("");
      setBudget(""); setEstimatedRevenue(""); setEstimatedCost("");
      fetchProjects();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create project.");
    } finally {
      setSaving(false);
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        description="Manage company projects, track progress and profitability."
        action={can("projects", "create") ? (
          <Button data-testid="project-trigger" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New Project
          </Button>
        ) : null}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by name or number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="planning">Planning</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects found" description="Create your first project to get started." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Manager</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>End Date</TableHead>
                    <TableHead>Budget</TableHead>
                    <TableHead>Est. Profit</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((p) => (
                    <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => viewProfile(p.id)}>
                      <TableCell className="font-mono text-xs">{p.projectNumber}</TableCell>
                      <TableCell className="text-sm font-medium">{p.name}</TableCell>
                      <TableCell className="text-xs">{p.customerName || "—"}</TableCell>
                      <TableCell className="text-xs">{p.projectManagerName || "—"}</TableCell>
                      <TableCell><Badge variant="outline" className={STATUS_BADGE[p.status] ?? ""}>{p.status.replace("_", " ")}</Badge></TableCell>
                      <TableCell><Badge variant="outline" className={PRIORITY_BADGE[p.priority] ?? ""}>{p.priority}</Badge></TableCell>
                      <TableCell className="text-xs">{formatDate(p.plannedEndDate)}</TableCell>
                      <TableCell className="text-xs">{formatMoney(p.budgetAmount)}</TableCell>
                      <TableCell className="text-xs font-medium">{formatMoney(String(Number(p.estimatedRevenue) - Number(p.estimatedCost)))}</TableCell>
                      <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>Create a new project.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="proj-name">Project Name</Label>
              <Input id="proj-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website Redesign" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-desc">Description</Label>
              <Textarea id="proj-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Customer (optional)</Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Project Manager</Label>
                <Select value={projectManagerId} onValueChange={setProjectManagerId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (<SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
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
                <Label htmlFor="proj-start">Start Date</Label>
                <Input id="proj-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proj-end">Planned End</Label>
                <Input id="proj-end" type="date" value={plannedEndDate} onChange={(e) => setPlannedEndDate(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="proj-budget">Budget</Label>
                <Input id="proj-budget" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proj-rev">Est. Revenue</Label>
                <Input id="proj-rev" value={estimatedRevenue} onChange={(e) => setEstimatedRevenue(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proj-cost">Est. Cost</Label>
                <Input id="proj-cost" value={estimatedCost} onChange={(e) => setEstimatedCost(e.target.value)} placeholder="0" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="button" data-testid="project-submit" onClick={handleSubmit} disabled={saving || !name.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
