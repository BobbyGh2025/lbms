"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarCheck, Plus, Loader2, CheckCircle, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";

interface LeaveRequestItem {
  id: string;
  reference: string;
  employeeId: string;
  employeeName: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  status: string;
  reason: string | null;
  requestedByName: string | null;
  rejectionReason: string | null;
}

interface LeaveType { id: string; name: string; code: string; }
interface EmployeeOption { id: string; fullName: string; employeeId: string; }

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  cancelled: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

export function StaffLeaveView() {
  const { can } = useAuth();
  const [items, setItems] = useState<LeaveRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [activeTab, setActiveTab] = useState("all");
  const [saving, setSaving] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const fetchLeave = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/staff/leave");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchLeave(); }, [fetchLeave]);

  useEffect(() => {
    if (!createOpen) return;
    (async () => {
      try {
        const [ltRes, empRes] = await Promise.all([
          fetch("/api/staff/leave-types"),
          fetch("/api/staff?pageSize=100"),
        ]);
        const lt = ltRes.ok ? await ltRes.json() : { items: [] };
        const emp = empRes.ok ? await empRes.json() : { items: [] };
        setLeaveTypes(lt.items ?? []);
        setEmployees(emp.items ?? []);
      } catch { /* silent */ }
    })();
  }, [createOpen]);

  const filtered = items.filter(i => {
    if (activeTab === "all") return true;
    return i.status === activeTab;
  });

  async function handleSubmit() {
    if (!employeeId || !leaveTypeId || !startDate || !endDate) {
      toast.error("Please fill in all required fields.");
      return;
    }
    if (new Date(startDate) > new Date(endDate)) {
      toast.error("End date must be on or after start date.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/staff/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, leaveTypeId, startDate, endDate, reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create leave request.");
      }
      toast.success("Leave request submitted.");
      setCreateOpen(false);
      setEmployeeId(""); setLeaveTypeId(""); setStartDate(""); setEndDate(""); setReason("");
      fetchLeave();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create leave request.");
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(id: string) {
    try {
      const res = await fetch(`/api/staff/leave/${id}/approve`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to approve.");
      }
      toast.success("Leave request approved.");
      fetchLeave();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve.");
    }
  }

  async function handleReject(id: string) {
    const reason = prompt("Reason for rejection (min 3 chars):");
    if (!reason || reason.trim().length < 3) {
      if (reason !== null) toast.error("Reason must be at least 3 characters.");
      return;
    }
    try {
      const res = await fetch(`/api/staff/leave/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to reject.");
      }
      toast.success("Leave request rejected.");
      fetchLeave();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reject.");
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leave Management"
        description="Submit, review, and approve employee leave requests."
        action={can("leave", "create") ? (
          <Button data-testid="leave-trigger" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Request Leave
          </Button>
        ) : null}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>
        <TabsContent value={activeTab} className="mt-4">
          {loading ? (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={CalendarCheck} title="No leave requests" description="Leave requests will appear here." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Employee</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Start</TableHead>
                        <TableHead>End</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-xs">{item.reference}</TableCell>
                          <TableCell className="text-sm">{item.employeeName}</TableCell>
                          <TableCell className="text-sm">{item.leaveTypeName}</TableCell>
                          <TableCell className="text-xs">{formatDate(item.startDate)}</TableCell>
                          <TableCell className="text-xs">{formatDate(item.endDate)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={STATUS_BADGE[item.status] ?? ""}>
                              {item.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {item.status === "pending" && (
                              <div className="flex gap-1">
                                {can("leave", "approve") && (
                                  <Button size="sm" variant="ghost" onClick={() => handleApprove(item.id)}>
                                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                                  </Button>
                                )}
                                {can("leave", "reject") && (
                                  <Button size="sm" variant="ghost" onClick={() => handleReject(item.id)}>
                                    <XCircle className="h-4 w-4 text-rose-600" />
                                  </Button>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Request Leave</DialogTitle>
            <DialogDescription>Submit a leave request for approval.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Select employee…" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.fullName} ({e.employeeId})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Leave Type</Label>
              <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
                <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((lt) => (
                    <SelectItem key={lt.id} value={lt.id}>{lt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lv-start">Start Date</Label>
                <Input id="lv-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lv-end">End Date</Label>
                <Input id="lv-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lv-reason">Reason</Label>
              <Textarea id="lv-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Brief reason for leave…" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="button" data-testid="leave-submit" onClick={handleSubmit} disabled={saving || !employeeId || !leaveTypeId || !startDate || !endDate}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
