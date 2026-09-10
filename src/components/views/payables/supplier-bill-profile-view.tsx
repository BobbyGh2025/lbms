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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, FileText, ShieldCheck, FolderKanban, Package,
  Plus, Loader2, AlertCircle, Ban, Send, CheckCircle2, Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/finance/money";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SupplierLite {
  id: string; supplierNumber: string;
  tradingName: string | null; legalName: string | null;
  email: string | null; phone: string | null;
  status: string; country: string; city: string | null;
}

interface BillItemLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
  ledgerAccountCode: string | null;
  inventoryItem?: {
    id: string; itemCode: string; name: string; unitOfMeasure: string | null;
  } | null;
}

interface BillPayment {
  id: string;
  paymentNumber: string;
  amount: string;
  paymentMethod: string;
  reference: string | null;
  status: string;
  paymentDate: string;
  postedAt: string | null;
  voidedAt: string | null;
  createdBy: { id: string; username: string } | null;
}

interface BillDetail {
  id: string;
  billNumber: string;
  supplierId: string;
  supplier: SupplierLite;
  supplierRef: string | null;
  projectId: string | null;
  project: { id: string; projectNumber: string; name: string; status: string } | null;
  billDate: string;
  dueDate: string | null;
  status: string;
  subtotal: string;
  tax: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  notes: string | null;
  journalId: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  voidedAt: string | null;
  approvedBy: { id: string; username: string } | null;
  createdBy: { id: string; username: string } | null;
  updatedBy: { id: string; username: string } | null;
  createdAt: string;
  updatedAt: string;
  overdue: boolean;
  items: BillItemLine[];
  payments: BillPayment[];
}

interface InventoryItemOption { id: string; label: string; }
interface LedgerAccountOption { code: string; label: string; }

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const BILL_STATUS_BADGE: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  submitted: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  approved: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  posted: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  partially_paid: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  paid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  voided: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const PAYMENT_STATUS_BADGE: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  posted: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  voided: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

// Non-posted states can be cancelled; posted (or partially_paid) must be voided.
const NON_POSTED_STATES = new Set(["draft", "submitted", "approved"]);
const BILL_TERMINAL = new Set(["paid", "voided"]);

function fmt(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short", day: "2-digit", year: "numeric",
    });
  } catch { return "—"; }
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

function money(v: string | null | undefined): string {
  if (!v) return "GHS 0.00";
  return formatMoney(v, "GHS");
}

function supplierLabel(s: SupplierLite | null) {
  if (!s) return "—";
  return s.tradingName || s.legalName || s.supplierNumber;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium break-words">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SupplierBillProfileView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { can } = useAuth();

  const [data, setData] = useState<BillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Add item dialog
  const [itemOpen, setItemOpen] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [iDesc, setIDesc] = useState("");
  const [iQty, setIQty] = useState("");
  const [iPrice, setIPrice] = useState("");
  const [iItemId, setIItemId] = useState("");
  const [iLedgerCode, setILedgerCode] = useState("");
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccountOption[]>([]);

  // Void dialog
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);

  // Cancel dialog
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Edit bill dialog (draft only)
  const [editOpen, setEditOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [eSupplierRef, setESupplierRef] = useState("");
  const [eNotes, setENotes] = useState("");

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/payables/bills/${id}`);
        if (cancelled) return;
        if (res.status === 404) { setData(null); return; }
        if (!res.ok) { toast.error("Failed to load bill."); return; }
        setData(await res.json());
      } catch {
        if (!cancelled) toast.error("Failed to load bill.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Load inventory items + expense ledger accounts when the Add Item dialog opens
  useEffect(() => {
    if (!itemOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const [invRes, ledRes] = await Promise.all([
          fetch("/api/inventory/items?pageSize=100").catch(() => null),
          fetch("/api/finance/categories?accountClass=expense").catch(() => null),
        ]);
        if (cancelled) return;
        if (invRes && invRes.ok) {
          const inv = await invRes.json();
          setInventoryItems((inv.items ?? []).map((x: any) => ({
            id: x.id,
            label: `${x.itemCode} — ${x.name}`,
          })));
        }
        if (ledRes && ledRes.ok) {
          const led = await ledRes.json();
          setLedgerAccounts((led.items ?? []).map((x: any) => ({
            code: x.code,
            label: `${x.code} — ${x.name}`,
          })));
        }
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [itemOpen]);

  // Sync edit form when the dialog opens
  useEffect(() => {
    if (editOpen) {
      setESupplierRef(data?.supplierRef ?? "");
      setENotes(data?.notes ?? "");
    }
  }, [editOpen, data]);

  function back() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "payables");
    params.delete("id");
    router.push(`?${params.toString()}`);
  }

  async function refresh() {
    if (!id) return;
    try {
      const res = await fetch(`/api/payables/bills/${id}`);
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
  }

  async function callTransition(
    endpoint: string,
    successMsg: string,
    options?: { method?: string; body?: Record<string, unknown> },
  ) {
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/payables/bills/${id}/${endpoint}`, {
        method: options?.method ?? "POST",
        headers: { "Content-Type": "application/json" },
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to ${endpoint} bill.`);
      }
      toast.success(successMsg);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${endpoint} bill.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddItem() {
    if (!iDesc.trim()) { toast.error("Description is required."); return; }
    if (!iQty || Number(iQty) <= 0) { toast.error("Quantity must be greater than zero."); return; }
    if (!iPrice || Number(iPrice) < 0) { toast.error("Unit price is required."); return; }
    setSavingItem(true);
    try {
      const res = await fetch(`/api/payables/bills/${id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: iDesc.trim(),
          quantity: iQty,
          unitPrice: iPrice,
          ledgerAccountCode: iLedgerCode || undefined,
          inventoryItemId: iItemId || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to add item.");
      }
      toast.success("Item added.");
      setItemOpen(false);
      setIDesc(""); setIQty(""); setIPrice("");
      setIItemId(""); setILedgerCode("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add item.");
    } finally {
      setSavingItem(false);
    }
  }

  async function handleSaveEdit() {
    if (!id) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/payables/bills/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierRef: eSupplierRef.trim() || null,
          notes: eNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update bill.");
      }
      toast.success("Bill updated.");
      setEditOpen(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update bill.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleVoid() {
    if (!voidReason.trim()) { toast.error("Reason is required to void a posted bill."); return; }
    setVoiding(true);
    setBusy(true);
    try {
      const res = await fetch(`/api/payables/bills/${id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: voidReason.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to void bill.");
      }
      toast.success("Bill voided. Journal reversed.");
      setVoidOpen(false);
      setVoidReason("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to void bill.");
    } finally {
      setVoiding(false);
      setBusy(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    setBusy(true);
    try {
      const res = await fetch(`/api/payables/bills/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason.trim() || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to cancel bill.");
      }
      toast.success("Bill cancelled.");
      setCancelOpen(false);
      setCancelReason("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel bill.");
    } finally {
      setCancelling(false);
      setBusy(false);
    }
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
        icon={FileText}
        title="No record selected"
        description="Choose a supplier bill from the directory to view its profile."
        action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={FileText}
        title="Bill not found"
        description="This supplier bill may have been removed."
        action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />
    );
  }

  const status = data.status;
  const canEdit = can("payables", "edit");
  const canSubmit = can("payables", "submit");
  const canApprove = can("payables", "approve");
  const canPost = can("payables", "post");
  const canVoid = can("payables", "void");
  const canCancel = can("payables", "cancel");

  const isTerminal = BILL_TERMINAL.has(status);
  const itemsEditable = status === "draft" && canEdit;
  const canEditBill = status === "draft" && canEdit;
  const canSubmitBill = status === "draft" && canSubmit;
  const canApproveBill = status === "submitted" && canApprove;
  const canPostBill = status === "approved" && canPost;
  const canVoidBill = (status === "posted" || status === "partially_paid") && canVoid;
  const canCancelBill = NON_POSTED_STATES.has(status) && canCancel;

  const itemsSubtotal = data.items.reduce(
    (acc, it) => acc + Number(it.quantity) * Number(it.unitPrice), 0,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.billNumber}
        description={`Supplier: ${supplierLabel(data.supplier)}`}
        action={<Button variant="outline" onClick={back}><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />

      {/* Header summary card */}
      <Card>
        <CardContent className="p-4 sm:p-6 flex flex-wrap items-center gap-3">
          <Badge variant="outline" className={BILL_STATUS_BADGE[status] ?? ""}>
            {status.replace("_", " ")}
          </Badge>
          {data.overdue && (
            <Badge variant="outline" className="bg-rose-500/10 text-rose-700 dark:text-rose-300">
              <AlertCircle className="h-3 w-3 mr-1" /> OVERDUE
            </Badge>
          )}
          <div className="text-sm">
            <span className="text-muted-foreground">Total: </span>
            <span className="font-semibold">{money(data.total)}</span>
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">Balance Due: </span>
            <span className="font-semibold text-rose-600">{money(data.balanceDue)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Due <span className={`font-medium ${data.overdue ? "text-rose-600" : ""}`}>{fmt(data.dueDate)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Action buttons (status + permission gated) */}
      {(canSubmitBill || canApproveBill || canPostBill || canVoidBill || canCancelBill || canEditBill) && !isTerminal && (
        <div className="flex flex-wrap gap-2">
          {canEditBill && (
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={busy}>
              Edit
            </Button>
          )}
          {canSubmitBill && (
            <Button
              size="sm"
              data-testid="submit-bill-action"
              onClick={() => callTransition("submit", "Bill submitted for approval.")}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Submit
            </Button>
          )}
          {canApproveBill && (
            <Button
              size="sm"
              data-testid="approve-bill-action"
              onClick={() => callTransition("approve", "Bill approved.")}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Approve
            </Button>
          )}
          {canPostBill && (
            <Button
              size="sm"
              data-testid="post-bill-action"
              onClick={() => callTransition("post", "Bill posted. Dr Expense / Cr AP.")}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />} Post
            </Button>
          )}
          {canVoidBill && (
            <Button
              size="sm"
              variant="outline"
              data-testid="void-bill-action"
              onClick={() => setVoidOpen(true)}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Void
            </Button>
          )}
          {canCancelBill && (
            <Button
              size="sm"
              variant="ghost"
              className="text-rose-600 hover:text-rose-700"
              data-testid="cancel-bill-action"
              onClick={() => setCancelOpen(true)}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Cancel
            </Button>
          )}
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="items">Items ({data.items.length})</TabsTrigger>
          <TabsTrigger value="payments">Payments ({data.payments.length})</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        {/* ============== OVERVIEW ============== */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Bill Information</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row label="Bill Number" value={data.billNumber} />
                <Row label="Status" value={<Badge variant="outline" className={BILL_STATUS_BADGE[status] ?? ""}>{status.replace("_", " ")}</Badge>} />
                <Row label="Bill Date" value={fmt(data.billDate)} />
                <Row label="Due Date" value={
                  <span className={data.overdue ? "text-rose-600 font-medium" : ""}>
                    {fmt(data.dueDate)}{data.overdue && <AlertCircle className="inline h-3 w-3 ml-1" />}
                  </span>
                } />
                {data.supplierRef && (
                  <Row label="Supplier Reference" value={<span className="font-mono text-xs">{data.supplierRef}</span>} />
                )}
                {data.submittedAt && <Row label="Submitted At" value={fmtDateTime(data.submittedAt)} />}
                {data.approvedAt && <Row label="Approved At" value={fmtDateTime(data.approvedAt)} />}
                {data.postedAt && <Row label="Posted At" value={fmtDateTime(data.postedAt)} />}
                {data.voidedAt && <Row label="Voided At" value={fmtDateTime(data.voidedAt)} />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Financial Summary</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row label="Subtotal" value={money(data.subtotal)} />
                <Row label="Tax" value={money(data.tax)} />
                <Row label="Total" value={<span className="text-base font-bold">{money(data.total)}</span>} />
                <div className="border-t pt-2 mt-2 space-y-1">
                  <Row label="Amount Paid" value={<span className="text-emerald-600 font-medium">{money(data.amountPaid)}</span>} />
                  <Row label="Balance Due" value={<span className="text-rose-600 font-bold">{money(data.balanceDue)}</span>} />
                  <Row label="Supplier" value={supplierLabel(data.supplier)} />
                </div>
              </CardContent>
            </Card>

            {data.project && (
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FolderKanban className="h-4 w-4" /> Project
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <Row label="Number" value={data.project.projectNumber} />
                  <Row label="Name" value={data.project.name} />
                  <Row label="Status" value={<Badge variant="outline" className="text-xs">{data.project.status.replace("_", " ")}</Badge>} />
                </CardContent>
              </Card>
            )}

            {data.notes && (
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
                <CardContent><p className="text-sm whitespace-pre-wrap">{data.notes}</p></CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ============== ITEMS ============== */}
        <TabsContent value="items" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Line Items</h3>
            {itemsEditable && (
              <Button size="sm" onClick={() => setItemOpen(true)}>
                <Plus className="h-4 w-4" /> Add Item
              </Button>
            )}
          </div>

          {data.items.length === 0 ? (
            <EmptyState icon={Package} title="No line items" description={itemsEditable ? "Add items to this bill before submitting it." : "This bill has no line items."} />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((it) => (
                        <TableRow key={it.id}>
                          <TableCell className="text-sm font-medium">
                            {it.description}
                            {it.inventoryItem && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {it.inventoryItem.itemCode} — {it.inventoryItem.name}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-mono">{it.ledgerAccountCode || "—"}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{Number(it.quantity).toLocaleString()}</TableCell>
                          <TableCell className="text-right text-xs">{money(it.unitPrice)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{money(it.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="border-t bg-muted/30 p-4">
                  <div className="ml-auto max-w-xs space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{money(String(itemsSubtotal.toFixed(2)))}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{money(data.tax)}</span></div>
                    <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span>{money(data.total)}</span></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ============== PAYMENTS ============== */}
        <TabsContent value="payments" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Supplier Payments
            </h3>
          </div>

          {data.payments.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No payments"
              description="Payments made against this bill will appear here. Record them from the Payments tab in the Payables directory."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Payment #</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">{p.paymentNumber}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{money(p.amount)}</TableCell>
                          <TableCell className="text-xs capitalize">{p.paymentMethod.replace("_", " ")}</TableCell>
                          <TableCell className="text-xs">{p.reference || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={PAYMENT_STATUS_BADGE[p.status] ?? ""}>
                              {p.status.replace("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{fmt(p.paymentDate)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
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
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>Created: <span className="font-medium text-foreground">{fmtDateTime(data.createdAt)}</span></span>
                <span>·</span>
                <span>Last Updated: <span className="font-medium text-foreground">{fmtDateTime(data.updatedAt)}</span></span>
                {data.createdBy && (
                  <>
                    <span>·</span>
                    <span>Created by: <span className="font-medium text-foreground">{data.createdBy.username}</span></span>
                  </>
                )}
                {data.approvedBy && (
                  <>
                    <span>·</span>
                    <span>Approved by: <span className="font-medium text-foreground">{data.approvedBy.username}</span></span>
                  </>
                )}
              </div>
              {data.journalId && (
                <p className="text-xs text-muted-foreground">
                  Linked Journal ID: <span className="font-mono text-foreground">{data.journalId}</span>
                </p>
              )}
              <p className="text-muted-foreground">
                Full audit trail (every transition: create, submit, approve, post, void, cancel, payment post/void)
                is available in the Audit Trail module with actor, timestamp, and previous/new values.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ============== EDIT BILL DIALOG ============== */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Edit Bill (Draft)</DialogTitle>
            <DialogDescription>
              Only draft bills can be edited. Totals are recomputed server-side after each save.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="e-ref">Supplier Reference</Label>
              <Input id="e-ref" value={eSupplierRef} onChange={(e) => setESupplierRef(e.target.value)} placeholder="Supplier's own invoice #…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-notes">Notes</Label>
              <Textarea id="e-notes" value={eNotes} onChange={(e) => setENotes(e.target.value)} rows={3} placeholder="Optional internal notes…" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-bill-edit"
              onClick={handleSaveEdit}
              disabled={savingEdit}
            >
              {savingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== ADD ITEM DIALOG ============== */}
      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Add Line Item</DialogTitle>
            <DialogDescription>Totals are recomputed server-side after each addition.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Inventory Item (optional)</Label>
              <Select value={iItemId} onValueChange={setIItemId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {inventoryItems.map((i) => (<SelectItem key={i.id} value={i.id}>{i.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-desc">Description *</Label>
              <Input id="i-desc" value={iDesc} onChange={(e) => setIDesc(e.target.value)} placeholder="e.g. Office supplies" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="i-qty">Quantity *</Label>
                <Input id="i-qty" inputMode="decimal" value={iQty} onChange={(e) => setIQty(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="i-price">Unit Price *</Label>
                <Input id="i-price" inputMode="decimal" value={iPrice} onChange={(e) => setIPrice(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Expense Category</Label>
              <Select value={iLedgerCode} onValueChange={setILedgerCode}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {ledgerAccounts.map((l) => (<SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setItemOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-bill-item"
              onClick={handleAddItem}
              disabled={savingItem || !iDesc.trim() || !iQty || !iPrice}
            >
              {savingItem && <Loader2 className="h-4 w-4 animate-spin" />}
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== VOID DIALOG ============== */}
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Void Posted Bill</DialogTitle>
            <DialogDescription>
              Voiding reverses the original journal (Dr AP / Cr Expense). The bill cannot be re-opened.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="void-reason">Reason *</Label>
              <Textarea
                id="void-reason"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                rows={3}
                placeholder="Explain why this bill is being voided (min 3 characters)…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="submit-bill-void"
              onClick={handleVoid}
              disabled={voiding || voidReason.trim().length < 3}
            >
              {voiding && <Loader2 className="h-4 w-4 animate-spin" />}
              Void Bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== CANCEL DIALOG ============== */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Cancel Bill</DialogTitle>
            <DialogDescription>
              Cancelling a non-posted bill marks it as voided. No journal reversal is needed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="cancel-reason">Reason (optional)</Label>
              <Textarea
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                placeholder="Optional explanation…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>Keep Bill</Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="submit-bill-cancel"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancel Bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
