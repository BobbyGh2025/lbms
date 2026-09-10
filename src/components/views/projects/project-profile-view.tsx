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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, FolderKanban, Users, Target, Calendar, DollarSign, TrendingUp } from "lucide-react";
import { toast } from "sonner";

interface ProjectDetail {
  id: string;
  projectNumber: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  startDate: string | null;
  plannedEndDate: string | null;
  actualEndDate: string | null;
  budgetAmount: string;
  estimatedRevenue: string;
  estimatedCost: string;
  notes: string | null;
  customer: { id: string; customerNumber: string; tradingName: string | null; legalName: string | null } | null;
  projectManager: { id: string; fullName: string; employeeId: string } | null;
  teamMembers: Array<{ id: string; employeeId: string; employeeName: string; role: string | null; status: string }>;
  milestones: Array<{ id: string; name: string; description: string | null; dueDate: string | null; completedDate: string | null; status: string }>;
  journals: Array<{ id: string; reference: string; transactionType: string; transactionDate: string; amount: string; status: string; description: string | null }>;
  activities: Array<{ id: string; activityType: string; subject: string; status: string; dueDate: string | null }>;
  finance?: { totalRevenue: string; totalCost: string; actualProfit: string };
}

const STATUS_BADGE: Record<string, string> = {
  planning: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  on_hold: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  completed: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  cancelled: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
}
function money(v: string) {
  const n = Number(v);
  if (!isFinite(n) || n === 0) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function ProjectProfileView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { can } = useAuth();
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`/api/projects/${id}`);
        if (!res.ok) { if (res.status === 404) setData(null); return; }
        setData(await res.json());
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, [id]);

  function back() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "projects");
    params.delete("id");
    router.push(`?${params.toString()}`);
  }

  async function handleStatusTransition(newStatus: string) {
    if (!id) return;
    setTransitioning(true);
    try {
      const res = await fetch(`/api/projects/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to transition status.");
      }
      toast.success(`Project status changed to ${newStatus.replace("_", " ")}.`);
      const updated = await fetch(`/api/projects/${id}`).then(r => r.json());
      setData(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setTransitioning(false);
    }
  }

  if (loading) return <div className="space-y-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!data) return <EmptyState icon={FolderKanban} title="Project not found" description="This project may have been removed." action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back</Button>} />;

  const projectedProfit = Number(data.estimatedRevenue) - Number(data.estimatedCost);
  const actualRevenue = data.finance ? Number(data.finance.totalRevenue) : 0;
  const actualCost = data.finance ? Number(data.finance.totalCost) : 0;
  const actualProfit = data.finance ? Number(data.finance.actualProfit) : 0;

  return (
    <div className="space-y-5">
      <PageHeader title={data.name} description={`Project ${data.projectNumber}`} action={<Button variant="outline" onClick={back}><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">Overview</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Number" value={data.projectNumber} />
            <Row label="Status" value={<Badge variant="outline" className={STATUS_BADGE[data.status] ?? ""}>{data.status.replace("_", " ")}</Badge>} />
            <Row label="Priority" value={<Badge variant="outline">{data.priority}</Badge>} />
            {data.customer && <Row label="Customer" value={data.customer.tradingName || data.customer.legalName || data.customer.customerNumber} />}
            {data.projectManager && <Row label="Manager" value={data.projectManager.fullName} />}
            <Row label="Start" value={fmt(data.startDate)} />
            <Row label="Planned End" value={fmt(data.plannedEndDate)} />
            {data.actualEndDate && <Row label="Actual End" value={fmt(data.actualEndDate)} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Financials (Planned)</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Budget" value={money(data.budgetAmount)} />
            <Row label="Est. Revenue" value={money(data.estimatedRevenue)} />
            <Row label="Est. Cost" value={money(data.estimatedCost)} />
            <Row label="Projected Profit" value={money(String(projectedProfit))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Financials (Actual)</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.finance ? (
              <>
                <Row label="Actual Revenue" value={money(String(actualRevenue))} />
                <Row label="Actual Cost" value={money(String(actualCost))} />
                <Row label="Actual Profit" value={money(String(actualProfit))} />
                <p className="text-[10px] text-muted-foreground mt-2">Derived from authoritative Finance ledger via Journal.projectId.</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No financial transactions linked to this project yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {can("projects", "edit") && (data.status === "planning" || data.status === "active" || data.status === "on_hold") && (
        <div className="flex gap-2">
          {data.status === "planning" && <Button size="sm" onClick={() => handleStatusTransition("active")} disabled={transitioning}>Activate</Button>}
          {data.status === "active" && <Button size="sm" variant="outline" onClick={() => handleStatusTransition("on_hold")} disabled={transitioning}>Put On Hold</Button>}
          {data.status === "on_hold" && <Button size="sm" onClick={() => handleStatusTransition("active")} disabled={transitioning}>Resume</Button>}
          {data.status === "active" && <Button size="sm" variant="default" onClick={() => handleStatusTransition("completed")} disabled={transitioning}>Complete</Button>}
          <Button size="sm" variant="destructive" onClick={() => handleStatusTransition("cancelled")} disabled={transitioning}>Cancel</Button>
        </div>
      )}

      <Tabs defaultValue="team">
        <TabsList>
          <TabsTrigger value="team">Team ({data.teamMembers.length})</TabsTrigger>
          <TabsTrigger value="milestones">Milestones ({data.milestones.length})</TabsTrigger>
          <TabsTrigger value="finance">Finance ({data.journals.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="team" className="mt-4">
          {data.teamMembers.length === 0 ? (
            <EmptyState icon={Users} title="No team members" description="No one has been assigned to this project." />
          ) : (
            <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.teamMembers.map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="text-sm">{t.employeeName}</TableCell>
                    <TableCell className="text-xs">{t.role || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{t.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div></CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="milestones" className="mt-4">
          {data.milestones.length === 0 ? (
            <EmptyState icon={Target} title="No milestones" description="No milestones have been created." />
          ) : (
            <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Due</TableHead><TableHead>Completed</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.milestones.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm">{m.name}</TableCell>
                    <TableCell className="text-xs">{fmt(m.dueDate)}</TableCell>
                    <TableCell className="text-xs">{fmt(m.completedDate)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{m.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div></CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="finance" className="mt-4">
          {data.journals.length === 0 ? (
            <EmptyState icon={DollarSign} title="No transactions" description="No financial transactions reference this project." />
          ) : (
            <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Type</TableHead><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.journals.map(j => (
                  <TableRow key={j.id}>
                    <TableCell className="font-mono text-xs">{j.reference}</TableCell>
                    <TableCell className="text-xs capitalize">{j.transactionType}</TableCell>
                    <TableCell className="text-xs">{fmt(j.transactionDate)}</TableCell>
                    <TableCell className="text-sm font-medium">{j.amount}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{j.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div></CardContent></Card>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">Financial data comes from the authoritative Finance ledger. No balances are invented.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-2"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value || "—"}</span></div>;
}
