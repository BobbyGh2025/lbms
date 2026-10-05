"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
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
import { Activity as ActivityIcon, Plus, Loader2, CheckCircle, Pencil } from "lucide-react";
import { toast } from "sonner";

interface ActivityItem {
  id: string;
  activityType: string;
  subject: string;
  description: string | null;
  customerId: string | null;
  supplierId: string | null;
  assignedToId: string | null;
  customerName: string | null;
  supplierName: string | null;
  assignedToName: string | null;
  dueDate: string | null;
  completedDate: string | null;
  status: string;
}

const STATUS_BADGE: Record<string, string> = {
  open: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  overdue: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export function ActivitiesView() {
  const { can } = useAuth();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ActivityItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [activityType, setActivityType] = useState("follow_up");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [customers, setCustomers] = useState<{id:string; name:string}[]>([]);
  const [suppliers, setSuppliers] = useState<{id:string; name:string}[]>([]);
  const [editActivityType, setEditActivityType] = useState("follow_up");
  const [editSubject, setEditSubject] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editCustomerId, setEditCustomerId] = useState("");
  const [editSupplierId, setEditSupplierId] = useState("");
  const [editStatus, setEditStatus] = useState("open");

  const fetchActivities = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/activities");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  useEffect(() => {
    const id = searchParams.get("id");
    if (!id || loading) return;
    const activity = items.find((item) => item.id === id);
    if (activity) openEdit(activity);
  }, [searchParams, loading, items]);

  useEffect(() => {
    if (!createOpen && !editOpen) return;
    (async () => {
      try {
        const [cRes, sRes] = await Promise.all([
          fetch("/api/customers?pageSize=100"),
          fetch("/api/suppliers?pageSize=100"),
        ]);
        const c = cRes.ok ? await cRes.json() : { items: [] };
        const s = sRes.ok ? await sRes.json() : { items: [] };
          setCustomers((c.items ?? []).map((x: any) => ({ id: x.id, name: x.tradingName || x.legalName || x.customerNumber })));
        setSuppliers((s.items ?? []).map((x: any) => ({ id: x.id, name: x.tradingName || x.legalName || x.supplierNumber })));
      } catch { /* silent */ }
    })();
  }, [createOpen]);

  async function handleSubmit() {
    if (!subject.trim()) { toast.error("Subject is required."); return; }
    if (customerId && supplierId) { toast.error("An activity can be linked to either a customer OR a supplier, not both."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityType,
          subject: subject.trim(),
          description: description.trim() || undefined,
          dueDate: dueDate || undefined,
          customerId: customerId || undefined,
          supplierId: supplierId || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create activity.");
      }
      toast.success("Activity created.");
      setCreateOpen(false);
      setSubject(""); setDescription(""); setDueDate(""); setCustomerId(""); setSupplierId("");
      fetchActivities();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create activity.");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(activity: ActivityItem) {
    setEditing(activity);
    setEditActivityType(activity.activityType);
    setEditSubject(activity.subject);
    setEditDescription(activity.description ?? "");
    setEditDueDate(activity.dueDate ? new Date(activity.dueDate).toISOString().slice(0, 10) : "");
    setEditCustomerId(activity.customerId ?? "");
    setEditSupplierId(activity.supplierId ?? "");
    setEditStatus(activity.status);
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!editing) return;
    if (!editSubject.trim()) { toast.error("Subject is required."); return; }
    if (editCustomerId && editSupplierId) {
      toast.error("An activity can be linked to either a customer OR a supplier, not both.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/activities/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityType: editActivityType,
          subject: editSubject.trim(),
          description: editDescription.trim() || null,
          dueDate: editDueDate || null,
          customerId: editCustomerId || null,
          supplierId: editSupplierId || null,
          status: editStatus,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update activity.");
      }
      toast.success("Activity updated.");
      setEditOpen(false);
      setEditing(null);
      await fetchActivities();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update activity.");
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete(id: string) {
    try {
      const res = await fetch(`/api/activities/${id}/complete`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to complete.");
      toast.success("Activity completed.");
      fetchActivities();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="CRM Activities"
        description="Track calls, meetings, follow-ups and relationship activities."
        action={can("activities", "create") ? (
          <Button data-testid="activity-trigger" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New Activity
          </Button>
        ) : null}
      />

      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={ActivityIcon} title="No activities" description="Create a call, meeting, or follow-up to start tracking." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Customer/Supplier</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs capitalize">{a.activityType.replace("_", " ")}</TableCell>
                      <TableCell className="text-sm font-medium">{a.subject}</TableCell>
                      <TableCell className="text-xs">{a.customerName || a.supplierName || "—"}</TableCell>
                      <TableCell className="text-xs">{formatDate(a.dueDate)}</TableCell>
                      <TableCell className="text-xs">{a.assignedToName || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_BADGE[a.status] ?? ""}>{a.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {can("activities", "edit") && (
                            <Button size="sm" variant="ghost" onClick={() => openEdit(a)} title="Edit activity">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {a.status === "open" && can("activities", "edit") && (
                            <Button size="sm" variant="ghost" onClick={() => handleComplete(a.id)} title="Complete activity">
                              <CheckCircle className="h-4 w-4 text-emerald-600" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>New Activity</DialogTitle>
            <DialogDescription>Log a call, meeting, or follow-up.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={activityType} onValueChange={setActivityType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="meeting">Meeting</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="follow_up">Follow-up</SelectItem>
                    <SelectItem value="site_visit">Site Visit</SelectItem>
                    <SelectItem value="quotation">Quotation</SelectItem>
                    <SelectItem value="note">Note</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="act-due">Due Date</Label>
                <Input id="act-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-subject">Subject</Label>
              <Input id="act-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Quotation follow-up" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-desc">Description</Label>
              <Textarea id="act-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Customer (optional)</Label>
                <Select value={customerId} onValueChange={(v) => { setCustomerId(v); if (v) setSupplierId(""); }}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Supplier (optional)</Label>
                <Select value={supplierId} onValueChange={(v) => { setSupplierId(v); if (v) setCustomerId(""); }}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="button" data-testid="activity-submit" onClick={handleSubmit} disabled={saving || !subject.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Activity
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Activity</DialogTitle>
            <DialogDescription>Update the activity details and status.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={editActivityType} onValueChange={setEditActivityType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="meeting">Meeting</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="follow_up">Follow-up</SelectItem>
                    <SelectItem value="site_visit">Site Visit</SelectItem>
                    <SelectItem value="quotation">Quotation</SelectItem>
                    <SelectItem value="note">Note</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-act-status">Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger id="edit-act-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-act-due">Due Date</Label>
              <Input id="edit-act-due" type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-act-subject">Subject</Label>
              <Input id="edit-act-subject" value={editSubject} onChange={(e) => setEditSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-act-desc">Description</Label>
              <Textarea id="edit-act-desc" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Select value={editCustomerId || "none"} onValueChange={(v) => { setEditCustomerId(v === "none" ? "" : v); if (v !== "none") setEditSupplierId(""); }}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Supplier</Label>
                <Select value={editSupplierId || "none"} onValueChange={(v) => { setEditSupplierId(v === "none" ? "" : v); if (v !== "none") setEditCustomerId(""); }}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="button" onClick={handleEdit} disabled={saving || !editSubject.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
