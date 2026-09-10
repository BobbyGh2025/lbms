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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { ClipboardList, Truck, Plus, Loader2, ChevronRight, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/finance/money";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestItem {
  id: string;
  requestNumber: string;
  title: string;
  status: string;
  priority: string;
  requestedDate: string;
  requiredByDate: string | null;
  requesterId: string;
  requester: { id: string; fullName: string; employeeNumber: string; employeeId: string } | null;
  projectId: string | null;
  project: { id: string; projectNumber: string; name: string } | null;
  taskId: string | null;
  task: { id: string; taskNumber: string; title: string } | null;
  supplierId: string | null;
  supplier: { id: string; supplierNumber: string; tradingName: string | null; legalName: string | null } | null;
  approvedBy: { id: string; username: string } | null;
  approvedAt: string | null;
  submittedAt: string | null;
  rejectedReason: string | null;
  convertedPurchaseOrder: { id: string; purchaseOrderNumber: string; status: string } | null;
  convertedAt: string | null;
}

interface POListItem {
  id: string;
  purchaseOrderNumber: string;
  status: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  sentAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  notes: string | null;
  supplierId: string;
  supplier: { id: string; supplierNumber: string; tradingName: string | null; legalName: string | null };
  projectId: string | null;
  project: { id: string; projectNumber: string; name: string } | null;
  procurementRequestId: string | null;
  procurementRequest: { id: string; requestNumber: string; title: string } | null;
  requestedById: string;
  requestedBy: { id: string; username: string };
  approvedById: string | null;
  approvedBy: { id: string; username: string } | null;
  approvedAt: string | null;
  _count: { items: number };
}

interface StaffOption { id: string; label: string; }
interface SupplierOption { id: string; label: string; }
interface ProjectOption { id: string; label: string; }
interface UserOption { id: string; label: string; }

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const REQUEST_STATUS_BADGE: Record<string, string> = {
  draft: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  submitted: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  converted: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  cancelled: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const PO_STATUS_BADGE: Record<string, string> = {
  draft: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  pending_approval: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  sent: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  partially_received: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  received: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  closed: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  cancelled: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const PRIORITY_BADGE: Record<string, string> = {
  low: "bg-zinc-500/10 text-zinc-600",
  medium: "bg-sky-500/10 text-sky-600",
  high: "bg-amber-500/10 text-amber-600",
  critical: "bg-rose-500/10 text-rose-600",
};

const REQUEST_TERMINAL = new Set(["rejected", "converted", "cancelled"]);
const PO_TERMINAL = new Set(["closed", "cancelled"]);

function isOverdue(dateStr: string | null, status: string, terminal: Set<string>) {
  if (!dateStr || terminal.has(status)) return false;
  try {
    return new Date(dateStr) < new Date();
  } catch { return false; }
}

function fmt(iso: string | null, withYear = false) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, withYear
      ? { month: "short", day: "2-digit", year: "numeric" }
      : { month: "short", day: "2-digit" });
  } catch { return "—"; }
}

function supplierLabel(s: { supplierNumber: string; tradingName: string | null; legalName: string | null } | null | undefined) {
  if (!s) return "—";
  return s.tradingName || s.legalName || s.supplierNumber;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProcurementView() {
  const { can, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("requests");

  // Requests list
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loadingReq, setLoadingReq] = useState(true);
  const [searchReq, setSearchReq] = useState("");
  const [statusReq, setStatusReq] = useState("all");
  const [priorityReq, setPriorityReq] = useState("all");

  // POs list
  const [pos, setPos] = useState<POListItem[]>([]);
  const [loadingPO, setLoadingPO] = useState(true);
  const [searchPO, setSearchPO] = useState("");
  const [statusPO, setStatusPO] = useState("all");

  // Reference data (shared)
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);

  // Create Request dialog
  const [reqOpen, setReqOpen] = useState(false);
  const [savingReq, setSavingReq] = useState(false);
  const [rTitle, setRTitle] = useState("");
  const [rRequesterId, setRRequesterId] = useState("");
  const [rSupplierId, setRSupplierId] = useState("");
  const [rProjectId, setRProjectId] = useState("");
  const [rPriority, setRPriority] = useState("medium");
  const [rRequiredBy, setRRequiredBy] = useState("");
  const [rNotes, setRNotes] = useState("");

  // Create PO dialog
  const [poOpen, setPoOpen] = useState(false);
  const [savingPO, setSavingPO] = useState(false);
  const [pSupplierId, setPSupplierId] = useState("");
  const [pProjectId, setPProjectId] = useState("");
  const [pRequestedById, setPRequestedById] = useState("");
  const [pExpected, setPExpected] = useState("");
  const [pNotes, setPNotes] = useState("");

  // ----- Fetchers -----
  const fetchRequests = useCallback(async () => {
    try {
      setLoadingReq(true);
      const params = new URLSearchParams();
      if (searchReq) params.set("search", searchReq);
      if (statusReq !== "all") params.set("status", statusReq);
      if (priorityReq !== "all") params.set("priority", priorityReq);
      params.set("pageSize", "50");
      const res = await fetch(`/api/procurement/requests?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setRequests(data.items ?? []);
    } catch {
      toast.error("Failed to load procurement requests.");
    } finally {
      setLoadingReq(false);
    }
  }, [searchReq, statusReq, priorityReq]);

  const fetchPOs = useCallback(async () => {
    try {
      setLoadingPO(true);
      const params = new URLSearchParams();
      if (searchPO) params.set("search", searchPO);
      if (statusPO !== "all") params.set("status", statusPO);
      params.set("pageSize", "50");
      const res = await fetch(`/api/procurement/orders?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setPos(data.items ?? []);
    } catch {
      toast.error("Failed to load purchase orders.");
    } finally {
      setLoadingPO(false);
    }
  }, [searchPO, statusPO]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);
  useEffect(() => { fetchPOs(); }, [fetchPOs]);

  // Load reference data when either dialog opens (once per dialog open)
  useEffect(() => {
    if (!reqOpen && !poOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const [sRes, supRes, prRes, uRes] = await Promise.all([
          fetch("/api/staff?pageSize=100"),
          fetch("/api/suppliers?pageSize=100"),
          fetch("/api/projects?pageSize=100"),
          fetch("/api/users?pageSize=100").catch(() => null),
        ]);
        if (cancelled) return;
        const s = sRes.ok ? await sRes.json() : { items: [] };
        const sup = supRes.ok ? await supRes.json() : { items: [] };
        const pr = prRes.ok ? await prRes.json() : { items: [] };
        setStaff((s.items ?? []).map((x: any) => ({ id: x.id, label: x.fullName || x.employeeId || x.employeeNumber })));
        setSuppliers((sup.items ?? []).map((x: any) => ({ id: x.id, label: x.tradingName || x.legalName || x.supplierNumber })));
        setProjects((pr.items ?? []).map((x: any) => ({ id: x.id, label: `${x.projectNumber} — ${x.name}` })));
        if (uRes && uRes.ok) {
          const u = await uRes.json();
          setUsers((u.items ?? []).map((x: any) => ({ id: x.id, label: x.username || x.email })));
        } else {
          // Fallback: only show the current user as a requester
          if (user) setUsers([{ id: user.id, label: user.username || user.email || "Current user" }]);
        }
      } catch {
        /* silent */
      }
    })();
    return () => { cancelled = true; };
  }, [reqOpen, poOpen, user]);

  // Pre-fill current user as default PO requester
  useEffect(() => {
    if (poOpen && user && !pRequestedById) {
      setPRequestedById(user.id);
    }
  }, [poOpen, user, pRequestedById]);

  // ----- Navigation -----
  function viewRequest(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "procurement-request-profile");
    params.set("id", id);
    router.push(`?${params.toString()}`);
  }
  function viewPO(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "purchase-order-profile");
    params.set("id", id);
    router.push(`?${params.toString()}`);
  }

  // ----- Submit handlers -----
  async function handleCreateRequest() {
    if (!rTitle.trim()) { toast.error("Title is required."); return; }
    if (!rRequesterId) { toast.error("Requester is required."); return; }
    setSavingReq(true);
    try {
      const res = await fetch("/api/procurement/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: rTitle.trim(),
          requesterId: rRequesterId,
          supplierId: rSupplierId || undefined,
          projectId: rProjectId || undefined,
          priority: rPriority,
          requiredByDate: rRequiredBy || undefined,
          notes: rNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create request.");
      }
      const created = await res.json();
      toast.success(`Request created: ${created.requestNumber}`);
      setReqOpen(false);
      setRTitle(""); setRRequesterId(""); setRSupplierId(""); setRProjectId("");
      setRPriority("medium"); setRRequiredBy(""); setRNotes("");
      fetchRequests();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create request.");
    } finally {
      setSavingReq(false);
    }
  }

  async function handleCreatePO() {
    if (!pSupplierId) { toast.error("Supplier is required."); return; }
    if (!pRequestedById) { toast.error("Requester is required."); return; }
    setSavingPO(true);
    try {
      const res = await fetch("/api/procurement/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: pSupplierId,
          projectId: pProjectId || undefined,
          requestedById: pRequestedById,
          expectedDeliveryDate: pExpected || undefined,
          notes: pNotes.trim() || undefined,
          status: "draft",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create purchase order.");
      }
      const created = await res.json();
      toast.success(`Purchase order created: ${created.purchaseOrderNumber}`);
      setPoOpen(false);
      setPSupplierId(""); setPProjectId(""); setPRequestedById("");
      setPExpected(""); setPNotes("");
      fetchPOs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create purchase order.");
    } finally {
      setSavingPO(false);
    }
  }

  // ----- Render -----
  return (
    <div className="space-y-5">
      <PageHeader
        title="Procurement"
        description="Procurement requests and purchase orders."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requests">Procurement Requests</TabsTrigger>
          <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
        </TabsList>

        {/* ============== REQUESTS TAB ============== */}
        <TabsContent value="requests" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="Search by request # or title…"
                value={searchReq}
                onChange={(e) => setSearchReq(e.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={statusReq} onValueChange={setStatusReq}>
                <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={priorityReq} onValueChange={setPriorityReq}>
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
            {can("procurement", "create") && (
              <Button onClick={() => setReqOpen(true)}>
                <Plus className="h-4 w-4" /> New Request
              </Button>
            )}
          </div>

          {loadingReq ? (
            <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : requests.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No procurement requests" description="Create your first request to get started." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Request #</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Requester</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Required By</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {requests.map((r) => {
                        const overdue = isOverdue(r.requiredByDate, r.status, REQUEST_TERMINAL);
                        return (
                          <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => viewRequest(r.id)}>
                            <TableCell className="font-mono text-xs">{r.requestNumber}</TableCell>
                            <TableCell className="text-sm font-medium">{r.title}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={REQUEST_STATUS_BADGE[r.status] ?? ""}>
                                {r.status.replace("_", " ")}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={PRIORITY_BADGE[r.priority] ?? ""}>{r.priority}</Badge>
                            </TableCell>
                            <TableCell className="text-xs">{r.requester?.fullName || "—"}</TableCell>
                            <TableCell className="text-xs">{supplierLabel(r.supplier)}</TableCell>
                            <TableCell className="text-xs">
                              <span className={overdue ? "text-amber-600 font-medium" : ""}>
                                {fmt(r.requiredByDate)}
                              </span>
                              {overdue && <AlertCircle className="inline h-3 w-3 ml-1 text-amber-600" />}
                            </TableCell>
                            <TableCell className="text-xs">{fmt(r.requestedDate)}</TableCell>
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
        </TabsContent>

        {/* ============== PURCHASE ORDERS TAB ============== */}
        <TabsContent value="orders" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="Search by PO number…"
                value={searchPO}
                onChange={(e) => setSearchPO(e.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={statusPO} onValueChange={setStatusPO}>
                <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="pending_approval">Pending Approval</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="partially_received">Partially Received</SelectItem>
                  <SelectItem value="received">Received</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {can("procurement", "create") && (
              <Button onClick={() => setPoOpen(true)}>
                <Plus className="h-4 w-4" /> New PO
              </Button>
            )}
          </div>

          {loadingPO ? (
            <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : pos.length === 0 ? (
            <EmptyState icon={Truck} title="No purchase orders" description="Create your first purchase order to get started." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>PO #</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Items</TableHead>
                        <TableHead>Order Date</TableHead>
                        <TableHead>Expected Delivery</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pos.map((p) => {
                        const overdue = isOverdue(p.expectedDeliveryDate, p.status, PO_TERMINAL);
                        return (
                          <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => viewPO(p.id)}>
                            <TableCell className="font-mono text-xs">{p.purchaseOrderNumber}</TableCell>
                            <TableCell className="text-sm font-medium">{supplierLabel(p.supplier)}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={PO_STATUS_BADGE[p.status] ?? ""}>
                                {p.status.replace("_", " ")}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm font-medium">{formatMoney(p.total, p.currency || "GHS")}</TableCell>
                            <TableCell className="text-xs">{p._count?.items ?? 0}</TableCell>
                            <TableCell className="text-xs">{fmt(p.orderDate)}</TableCell>
                            <TableCell className="text-xs">
                              <span className={overdue ? "text-amber-600 font-medium" : ""}>
                                {fmt(p.expectedDeliveryDate)}
                              </span>
                              {overdue && <AlertCircle className="inline h-3 w-3 ml-1 text-amber-600" />}
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
        </TabsContent>
      </Tabs>

      {/* ============== CREATE REQUEST DIALOG ============== */}
      <Dialog open={reqOpen} onOpenChange={setReqOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>New Procurement Request</DialogTitle>
            <DialogDescription>Create a draft procurement request.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="req-title">Title</Label>
              <Input id="req-title" value={rTitle} onChange={(e) => setRTitle(e.target.value)} placeholder="e.g. Office chairs for new team" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Requester</Label>
                <Select value={rRequesterId} onValueChange={setRRequesterId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Supplier (optional)</Label>
                <Select value={rSupplierId} onValueChange={setRSupplierId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Project (optional)</Label>
                <Select value={rProjectId} onValueChange={setRProjectId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={rPriority} onValueChange={setRPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-required">Required By</Label>
              <Input id="req-required" type="date" value={rRequiredBy} onChange={(e) => setRRequiredBy(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-notes">Notes</Label>
              <Textarea id="req-notes" value={rNotes} onChange={(e) => setRNotes(e.target.value)} rows={2} placeholder="Additional context for the approver…" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReqOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-request"
              onClick={handleCreateRequest}
              disabled={savingReq || !rTitle.trim() || !rRequesterId}
            >
              {savingReq && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== CREATE PO DIALOG ============== */}
      <Dialog open={poOpen} onOpenChange={setPoOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
            <DialogDescription>Create a draft purchase order for a supplier.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <Select value={pSupplierId} onValueChange={setPSupplierId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Project (optional)</Label>
                <Select value={pProjectId} onValueChange={setPProjectId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Requested By</Label>
                <Select value={pRequestedById} onValueChange={setPRequestedById}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (<SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="po-expected">Expected Delivery Date</Label>
              <Input id="po-expected" type="date" value={pExpected} onChange={(e) => setPExpected(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="po-notes">Notes</Label>
              <Textarea id="po-notes" value={pNotes} onChange={(e) => setPNotes(e.target.value)} rows={2} placeholder="Optional notes for the supplier…" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPoOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-po"
              onClick={handleCreatePO}
              disabled={savingPO || !pSupplierId || !pRequestedById}
            >
              {savingPO && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Purchase Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
