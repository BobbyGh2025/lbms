"use client";

import { useEffect, useState } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft, ClipboardList, Truck, FolderKanban, FileText,
  ShieldCheck, AlertCircle, ChevronRight, Loader2,
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestDetail {
  id: string;
  requestNumber: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  requestedDate: string;
  requiredByDate: string | null;
  notes: string | null;
  submittedAt: string | null;
  submittedById: string | null;
  approvedAt: string | null;
  approvedById: string | null;
  approvedBy: { id: string; username: string } | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  cancelledAt: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  requester: { id: string; fullName: string; employeeNumber: string; employeeId: string } | null;
  project: { id: string; projectNumber: string; name: string; status: string } | null;
  task: { id: string; taskNumber: string; title: string; status: string } | null;
  supplier: { id: string; supplierNumber: string; tradingName: string | null; legalName: string | null; status: string } | null;
  createdBy: { id: string; username: string } | null;
  convertedPurchaseOrder: { id: string; purchaseOrderNumber: string; status: string; total: string } | null;
}

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  submitted: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  converted: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  cancelled: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const PRIORITY_BADGE: Record<string, string> = {
  low: "bg-zinc-500/10 text-zinc-600",
  medium: "bg-sky-500/10 text-sky-600",
  high: "bg-amber-500/10 text-amber-600",
  critical: "bg-rose-500/10 text-rose-600",
};

const REQUEST_TERMINAL = new Set(["rejected", "converted", "cancelled"]);

function fmt(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
  } catch { return "—"; }
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

function isOverdue(dateStr: string | null, status: string) {
  if (!dateStr || REQUEST_TERMINAL.has(status)) return false;
  try { return new Date(dateStr) < new Date(); } catch { return false; }
}

function supplierLabel(s: { supplierNumber: string; tradingName: string | null; legalName: string | null } | null | undefined) {
  if (!s) return "—";
  return s.tradingName || s.legalName || s.supplierNumber;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProcurementRequestProfileView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { can } = useAuth();

  const [data, setData] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Reject dialog
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/procurement/requests/${id}`);
        if (cancelled) return;
        if (res.status === 404) { setData(null); return; }
        if (!res.ok) { toast.error("Failed to load request."); return; }
        setData(await res.json());
      } catch {
        if (!cancelled) toast.error("Failed to load request.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  function back() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "procurement");
    params.delete("id");
    router.push(`?${params.toString()}`);
  }

  async function refresh() {
    if (!id) return;
    try {
      const res = await fetch(`/api/procurement/requests/${id}`);
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
  }

  async function callTransition(endpoint: string, method = "POST", body?: Record<string, unknown>) {
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/procurement/requests/${id}/${endpoint}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to ${endpoint}.`);
      }
      toast.success(`Request ${endpoint}.`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${endpoint}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() { await callTransition("submit"); }
  async function handleApprove() { await callTransition("approve"); }
  async function handleCancel() { await callTransition("cancel"); }

  async function handleReject() {
    if (!rejectReason.trim()) { toast.error("Rejection reason is required."); return; }
    setRejecting(true);
    try {
      const res = await fetch(`/api/procurement/requests/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to reject request.");
      }
      toast.success("Request rejected.");
      setRejectOpen(false);
      setRejectReason("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reject request.");
    } finally {
      setRejecting(false);
    }
  }

  function viewPO() {
    if (!data?.convertedPurchaseOrder) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "purchase-order-profile");
    params.set("id", data.convertedPurchaseOrder.id);
    router.push(`?${params.toString()}`);
  }

  // ----- Render states -----
  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!id) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No record selected"
        description="Choose a procurement request from the directory to view its profile."
        action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Request not found"
        description="This procurement request may have been removed."
        action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />
    );
  }

  const overdue = isOverdue(data.requiredByDate, data.status);
  const canSubmit = data.status === "draft" && can("procurement", "submit");
  const canApprove = data.status === "submitted" && can("procurement", "approve");
  const canCancel = ["draft", "submitted", "approved"].includes(data.status) && can("procurement", "cancel");

  // Approval timeline steps
  const steps = [
    { key: "draft", label: "Draft", reached: true },
    { key: "submitted", label: "Submitted", reached: ["submitted","approved","rejected","converted"].includes(data.status) || !!data.submittedAt },
    { key: "approved", label: "Approved", reached: ["approved","converted"].includes(data.status) },
    { key: "final", label: data.status === "rejected" ? "Rejected" : data.status === "cancelled" ? "Cancelled" : data.status === "converted" ? "Converted" : "Pending", reached: REQUEST_TERMINAL.has(data.status) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.title}
        description={`Request ${data.requestNumber}`}
        action={<Button variant="outline" onClick={back}><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />

      {/* Header summary card */}
      <Card>
        <CardContent className="p-4 sm:p-6 flex flex-wrap items-center gap-3">
          <Badge variant="outline" className={STATUS_BADGE[data.status] ?? ""}>
            {data.status.replace("_", " ")}
          </Badge>
          <Badge variant="outline" className={PRIORITY_BADGE[data.priority] ?? ""}>
            {data.priority} priority
          </Badge>
          {overdue && (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-300">
              <AlertCircle className="h-3 w-3 mr-1" /> Overdue
            </Badge>
          )}
          <div className="ml-auto text-xs text-muted-foreground">
            Required by <span className={overdue ? "font-medium text-amber-600" : "font-medium"}>{fmt(data.requiredByDate)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Action buttons */}
      {(canSubmit || canApprove || canCancel) && (
        <div className="flex flex-wrap gap-2">
          {canSubmit && (
            <Button size="sm" data-testid="submit-req" onClick={handleSubmit} disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Submit for Approval
            </Button>
          )}
          {canApprove && (
            <>
              <Button size="sm" data-testid="approve-req" onClick={handleApprove} disabled={busy}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Approve
              </Button>
              <Button size="sm" variant="destructive" data-testid="reject-req" onClick={() => setRejectOpen(true)} disabled={busy}>
                Reject
              </Button>
            </>
          )}
          {canCancel && (
            <Button size="sm" variant="outline" data-testid="cancel-req" onClick={handleCancel} disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Cancel Request
            </Button>
          )}
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="approval">Approval</TabsTrigger>
          <TabsTrigger value="supplier">Supplier</TabsTrigger>
          <TabsTrigger value="project">Project</TabsTrigger>
          <TabsTrigger value="po">Purchase Order</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        {/* ============== OVERVIEW ============== */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Request Details</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Number" value={data.requestNumber} />
                <Row label="Title" value={data.title} />
                <Row label="Status" value={<Badge variant="outline" className={STATUS_BADGE[data.status] ?? ""}>{data.status.replace("_", " ")}</Badge>} />
                <Row label="Priority" value={<Badge variant="outline" className={PRIORITY_BADGE[data.priority] ?? ""}>{data.priority}</Badge>} />
                <Row label="Required By" value={<span className={overdue ? "text-amber-600 font-medium" : ""}>{fmt(data.requiredByDate)}{overdue && <AlertCircle className="inline h-3 w-3 ml-1" />}</span>} />
                <Row label="Requested Date" value={fmt(data.requestedDate)} />
                <Row label="Requester" value={data.requester?.fullName || "—"} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Notes & Description</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {data.description ? (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Description</p>
                    <p className="whitespace-pre-wrap">{data.description}</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No description provided.</p>
                )}
                {data.notes ? (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Notes</p>
                    <p className="whitespace-pre-wrap">{data.notes}</p>
                  </div>
                ) : null}
                <div className="border-t pt-2 space-y-1 text-xs text-muted-foreground">
                  <Row label="Created" value={fmtDateTime(data.createdAt)} />
                  <Row label="Updated" value={fmtDateTime(data.updatedAt)} />
                  {data.createdBy && <Row label="Created By" value={data.createdBy.username} />}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ============== APPROVAL ============== */}
        <TabsContent value="approval" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Approval Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="space-y-3">
                {steps.map((s, idx) => {
                  const isLast = idx === steps.length - 1;
                  return (
                    <li key={s.key} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`h-3 w-3 rounded-full ${s.reached ? "bg-emerald-500" : "bg-zinc-300"}`} />
                        {!isLast && <div className="w-px flex-1 bg-border min-h-[24px]" />}
                      </div>
                      <div className="pb-2">
                        <p className={`text-sm font-medium ${s.reached ? "" : "text-muted-foreground"}`}>{s.label}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>

              <div className="grid gap-2 sm:grid-cols-2 pt-2 border-t">
                <Row label="Submitted At" value={fmtDateTime(data.submittedAt)} />
                <Row label="Approved At" value={fmtDateTime(data.approvedAt)} />
                <Row label="Approved By" value={data.approvedBy?.username || "—"} />
                <Row label="Rejected Reason" value={data.rejectedReason || "—"} />
              </div>

              {data.status === "submitted" && (
                <div className="mt-3 p-3 rounded-md bg-amber-500/10 text-amber-800 dark:text-amber-200 text-xs">
                  <AlertCircle className="inline h-3.5 w-3.5 mr-1" />
                  This request is awaiting approval. Self-approval is blocked unless you are MD.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============== SUPPLIER ============== */}
        <TabsContent value="supplier" className="mt-4">
          {data.supplier ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Truck className="h-4 w-4" /> Supplier
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Number" value={data.supplier.supplierNumber} />
                <Row label="Trading Name" value={data.supplier.tradingName || "—"} />
                <Row label="Legal Name" value={data.supplier.legalName || "—"} />
                <Row label="Status" value={<Badge variant="outline" className="text-xs">{data.supplier.status}</Badge>} />
              </CardContent>
            </Card>
          ) : (
            <EmptyState icon={Truck} title="No supplier assigned" description="This request has not been linked to a supplier." />
          )}
        </TabsContent>

        {/* ============== PROJECT ============== */}
        <TabsContent value="project" className="mt-4">
          {data.project ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <FolderKanban className="h-4 w-4" /> Project
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Number" value={data.project.projectNumber} />
                <Row label="Name" value={data.project.name} />
                <Row label="Status" value={<Badge variant="outline" className="text-xs">{data.project.status.replace("_", " ")}</Badge>} />
                {data.task && (
                  <>
                    <div className="border-t pt-2 mt-2" />
                    <Row label="Task" value={`${data.task.taskNumber} — ${data.task.title}`} />
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <EmptyState icon={FolderKanban} title="Not linked to a project" description="This request is not associated with a project." />
          )}
        </TabsContent>

        {/* ============== PURCHASE ORDER ============== */}
        <TabsContent value="po" className="mt-4">
          {data.convertedPurchaseOrder ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Converted Purchase Order
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-3 text-sm">
                  <Row label="PO Number" value={data.convertedPurchaseOrder.purchaseOrderNumber} />
                  <Row label="Status" value={<Badge variant="outline" className="text-xs">{data.convertedPurchaseOrder.status.replace("_", " ")}</Badge>} />
                  <Row label="Converted At" value={fmt(data.convertedAt)} />
                </div>
                <Button variant="outline" size="sm" onClick={viewPO}>
                  Open PO Profile <ChevronRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ) : (
            <EmptyState icon={FileText} title="Not yet converted to a purchase order" description="Once approved, this request can be converted to a purchase order." />
          )}
        </TabsContent>

        {/* ============== AUDIT ============== */}
        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Audit Trail
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Audit trail available in the Audit Trail module. Every action on this request
                (create, submit, approve, reject, cancel) is recorded with the actor, timestamp,
                and previous/new values for full traceability.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ============== REJECT DIALOG ============== */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Reject Request</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting {data.requestNumber}. The requester will be notified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Rejection Reason</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="e.g. Budget not available this quarter…"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleReject}
              disabled={rejecting || !rejectReason.trim()}
            >
              {rejecting && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value ?? "—"}</span>
    </div>
  );
}
