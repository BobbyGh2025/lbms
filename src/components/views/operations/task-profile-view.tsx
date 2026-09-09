"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, ClipboardList, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface TaskDetail {
  id: string;
  taskNumber: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  startDate: string | null;
  completedDate: string | null;
  estimatedHours: string;
  actualHours: string;
  notes: string | null;
  project: { id: string; name: string; projectNumber: string } | null;
  customer: { id: string; tradingName: string | null; legalName: string | null } | null;
  assignedEmployee: { id: string; fullName: string; employeeId: string } | null;
  createdBy: { id: string; username: string } | null;
  checklists: Array<{
    id: string;
    name: string;
    status: string;
    items: Array<{ id: string; description: string; isCompleted: boolean; completedAt: string | null }>;
  }>;
}

const STATUS_BADGE: Record<string, string> = {
  todo: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  in_progress: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  on_hold: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  completed: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  cancelled: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
}

function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || status === "completed" || status === "cancelled") return false;
  return new Date(dueDate) < new Date();
}

export function TaskProfileView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { can } = useAuth();
  const [data, setData] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`/api/tasks/${id}`);
        if (!res.ok) { if (res.status === 404) setData(null); return; }
        setData(await res.json());
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, [id]);

  function back() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "operations");
    params.delete("id");
    router.push(`?${params.toString()}`);
  }

  async function handleStatusTransition(newStatus: string) {
    if (!id) return;
    setTransitioning(true);
    try {
      const res = await fetch(`/api/tasks/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed.");
      }
      toast.success(`Task status: ${newStatus.replace("_", " ")}`);
      const updated = await fetch(`/api/tasks/${id}`).then(r => r.json());
      setData(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setTransitioning(false);
    }
  }

  async function toggleChecklistItem(checklistId: string, itemId: string, completed: boolean) {
    try {
      const res = await fetch(`/api/tasks/${id}/checklists/${checklistId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCompleted: !completed }),
      });
      if (!res.ok) throw new Error("Failed.");
      const updated = await fetch(`/api/tasks/${id}`).then(r => r.json());
      setData(updated);
    } catch {
      toast.error("Failed to update checklist item.");
    }
  }

  if (loading) return <div className="space-y-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!data) return <EmptyState icon={ClipboardList} title="Task not found" action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back</Button>} />;

  const overdue = isOverdue(data.dueDate, data.status);
  const isTerminal = data.status === "completed" || data.status === "cancelled";

  return (
    <div className="space-y-5">
      <PageHeader title={data.title} description={`Task ${data.taskNumber}`} action={<Button variant="outline" onClick={back}><ArrowLeft className="h-4 w-4" /> Back</Button>} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Overview</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Number" value={data.taskNumber} />
            <Row label="Status" value={<Badge variant="outline" className={STATUS_BADGE[data.status] ?? ""}>{data.status.replace("_", " ")}</Badge>} />
            <Row label="Priority" value={<Badge variant="outline">{data.priority}</Badge>} />
            {data.description && <Row label="Description" value={data.description} />}
            <Row label="Due" value={<span className={overdue ? "text-rose-600 font-medium" : ""}>{fmt(data.dueDate)}{overdue && <AlertCircle className="inline h-3 w-3 ml-1" />}</span>} />
            <Row label="Started" value={fmt(data.startDate)} />
            <Row label="Completed" value={fmt(data.completedDate)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Assignment & Links</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.assignedEmployee && <Row label="Assignee" value={data.assignedEmployee.fullName} />}
            {data.createdBy && <Row label="Created By" value={data.createdBy.username} />}
            {data.project && <Row label="Project" value={`${data.project.projectNumber} — ${data.project.name}`} />}
            {data.customer && <Row label="Customer" value={data.customer.tradingName || data.customer.legalName || "—"} />}
            {data.notes && <Row label="Notes" value={data.notes} />}
          </CardContent>
        </Card>
      </div>

      {can("operations", "edit") && !isTerminal && (
        <div className="flex flex-wrap gap-2">
          {data.status === "todo" && <Button size="sm" onClick={() => handleStatusTransition("in_progress")}>Start</Button>}
          {data.status === "in_progress" && <Button size="sm" variant="outline" onClick={() => handleStatusTransition("on_hold")}>Put On Hold</Button>}
          {data.status === "on_hold" && <Button size="sm" onClick={() => handleStatusTransition("in_progress")}>Resume</Button>}
          {data.status === "in_progress" && <Button size="sm" variant="default" onClick={() => handleStatusTransition("completed")}>Complete</Button>}
          <Button size="sm" variant="destructive" onClick={() => handleStatusTransition("cancelled")}>Cancel</Button>
        </div>
      )}

      <Tabs defaultValue="checklists">
        <TabsList>
          <TabsTrigger value="checklists">Checklists ({data.checklists.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="checklists" className="mt-4">
          {data.checklists.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No checklists" description="No checklists have been created for this task." />
          ) : (
            <div className="space-y-4">
              {data.checklists.map(cl => (
                <Card key={cl.id}>
                  <CardHeader><CardTitle className="text-sm">{cl.name}</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {cl.items.map(item => (
                      <div key={item.id} className="flex items-center gap-3">
                        <Checkbox
                          checked={item.isCompleted}
                          onCheckedChange={() => toggleChecklistItem(cl.id, item.id, item.isCompleted)}
                          disabled={!can("operations", "edit") || isTerminal}
                        />
                        <span className={`text-sm ${item.isCompleted ? "line-through text-muted-foreground" : ""}`}>
                          {item.description}
                        </span>
                      </div>
                    ))}
                    {cl.items.length === 0 && <p className="text-xs text-muted-foreground">No items in this checklist.</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-2"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value || "—"}</span></div>;
}
