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
  Alert, AlertDescription, AlertTitle,
} from "@/components/ui/alert";
import {
  ArrowLeft, Truck, FileText, FolderKanban, Package,
  ShieldCheck, AlertCircle, Plus, Loader2, Pencil, Trash2, Boxes,
} from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/finance/money";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PODetail {
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
  createdAt: string;
  updatedAt: string;
  supplier: {
    id: string; supplierNumber: string; tradingName: string | null;
    legalName: string | null; email: string | null; phone: string | null;
    status: string; country: string; city: string | null;
  };
  project: { id: string; projectNumber: string; name: string; status: string } | null;
  procurementRequest: { id: string; requestNumber: string; title: string; status: string } | null;
  requestedBy: { id: string; username: string };
  approvedBy: { id: string; username: string } | null;
  approvedAt: string | null;
  createdBy: { id: string; username: string } | null;
  items: POItemLine[];
  goodsReceipts: Receipt[];
}

interface POItemLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  tax: string;
  total: string;
  receivedQuantity: string;
  status: string;
}

interface ReceiptItem {
  id: string;
  receivedQuantity: string;
  notes: string | null;
  purchaseOrderItem: { description: string } | null;
}

interface Receipt {
  id: string;
  receiptNumber: string;
  receiptDate: string;
  notes: string | null;
  status: string;
  receivedBy: { id: string; username: string } | null;
  items: ReceiptItem[];
}

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

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

const ITEM_STATUS_BADGE: Record<string, string> = {
  pending: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  partially_received: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  received: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const PO_TERMINAL = new Set(["closed", "cancelled"]);
const PO_ITEM_EDITABLE = new Set(["draft", "pending_approval", "approved"]);

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
  if (!dateStr || PO_TERMINAL.has(status)) return false;
  try { return new Date(dateStr) < new Date(); } catch { return false; }
}

function supplierLabel(s: { supplierNumber: string; tradingName: string | null; legalName: string | null }) {
  return s.tradingName || s.legalName || s.supplierNumber;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PurchaseOrderProfileView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { can } = useAuth();

  const [data, setData] = useState<PODetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Add item dialog
  const [itemOpen, setItemOpen] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [iDesc, setIDesc] = useState("");
  const [iQty, setIQty] = useState("");
  const [iPrice, setIPrice] = useState("");
  const [iTaxRate, setITaxRate] = useState("0");

  // Edit item dialog
  const [editItem, setEditItem] = useState<POItemLine | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Receive dialog
  const [recvOpen, setRecvOpen] = useState(false);
  const [recvDate, setRecvDate] = useState("");
  const [recvNotes, setRecvNotes] = useState("");
  const [recvLines, setRecvLines] = useState<Record<string, string>>({});
  const [savingRecv, setSavingRecv] = useState(false);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/procurement/orders/${id}`);
        if (cancelled) return;
        if (res.status === 404) { setData(null); return; }
        if (!res.ok) { toast.error("Failed to load purchase order."); return; }
        setData(await res.json());
      } catch {
        if (!cancelled) toast.error("Failed to load purchase order.");
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
      const res = await fetch(`/api/procurement/orders/${id}`);
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
  }

  async function callTransition(endpoint: string) {
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/procurement/orders/${id}/${endpoint}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to ${endpoint}.`);
      }
      toast.success(`Purchase order ${endpoint}.`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${endpoint}.`);
    } finally {
      setBusy(false);
    }
  }

  // ----- Item handlers -----
  async function handleAddItem() {
    if (!iDesc.trim()) { toast.error("Description is required."); return; }
    if (!iQty || Number(iQty) <= 0) { toast.error("Quantity must be greater than zero."); return; }
    if (!iPrice || Number(iPrice) < 0) { toast.error("Unit price is required."); return; }
    setSavingItem(true);
    try {
      const res = await fetch(`/api/procurement/orders/${id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: iDesc.trim(),
          quantity: iQty,
          unitPrice: iPrice,
          taxRate: iTaxRate || "0",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to add item.");
      }
      toast.success("Item added.");
      setItemOpen(false);
      setIDesc(""); setIQty(""); setIPrice(""); setITaxRate("0");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add item.");
    } finally {
      setSavingItem(false);
    }
  }

  async function handleSaveEdit() {
    if (!editItem) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/procurement/orders/${id}/items/${editItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: editItem.description,
          quantity: editItem.quantity,
          unitPrice: editItem.unitPrice,
          taxRate: editItem.taxRate,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update item.");
      }
      toast.success("Item updated.");
      setEditItem(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update item.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!confirm("Delete this line item? This cannot be undone.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/procurement/orders/${id}/items/${itemId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete item.");
      }
      toast.success("Item deleted.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete item.");
    } finally {
      setBusy(false);
    }
  }

  // ----- Receive handler -----
  function openReceiveDialog() {
    setRecvDate(new Date().toISOString().slice(0, 10));
    setRecvNotes("");
    setRecvLines({});
    setRecvOpen(true);
  }

  async function handleReceive() {
    const lines = Object.entries(recvLines)
      .filter(([, qty]) => qty && Number(qty) > 0)
      .map(([itemId, qty]) => ({ purchaseOrderItemId: itemId, receivedQuantity: qty }));
    if (lines.length === 0) {
      toast.error("Enter a received quantity for at least one item.");
      return;
    }
    setSavingRecv(true);
    try {
      const res = await fetch(`/api/procurement/orders/${id}/receiving`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptDate: recvDate || undefined,
          notes: recvNotes.trim() || undefined,
          items: lines,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to record receipt.");
      }
      const result = await res.json();
      const receiptNumber = result?.receipt?.receiptNumber || "receipt";
      toast.success(`Receipt recorded: ${receiptNumber}`);
      setRecvOpen(false);
      setRecvLines({});
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record receipt.");
    } finally {
      setSavingRecv(false);
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
        description="Choose a purchase order from the directory to view its profile."
        action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={FileText}
        title="Purchase order not found"
        description="This purchase order may have been removed."
        action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />
    );
  }

  const overdue = isOverdue(data.expectedDeliveryDate, data.status);
  const currency = data.currency || "GHS";
  const canEdit = can("procurement", "edit");
  const canReceive = can("procurement", "receive");
  const itemsEditable = PO_ITEM_EDITABLE.has(data.status) && canEdit;
  const canReceiveItems = (data.status === "sent" || data.status === "partially_received") && canReceive;

  // Items eligible for receiving (pending or partially_received)
  const receivableItems = data.items.filter(it => it.status === "pending" || it.status === "partially_received");

  // Totals
  const itemsSubtotal = data.items.reduce((acc, it) => acc + Number(it.quantity) * Number(it.unitPrice), 0);
  const itemsTax = data.items.reduce((acc, it) => acc + Number(it.tax), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.purchaseOrderNumber}
        description={`Supplier: ${supplierLabel(data.supplier)}`}
        action={<Button variant="outline" onClick={back}><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />

      {/* Header summary card */}
      <Card>
        <CardContent className="p-4 sm:p-6 flex flex-wrap items-center gap-3">
          <Badge variant="outline" className={PO_STATUS_BADGE[data.status] ?? ""}>
            {data.status.replace("_", " ")}
          </Badge>
          <div className="text-sm">
            <span className="text-muted-foreground">Total: </span>
            <span className="font-semibold">{formatMoney(data.total, currency)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Expected delivery <span className={overdue ? "font-medium text-amber-600" : "font-medium"}>{fmt(data.expectedDeliveryDate)}</span>
          </div>
          {overdue && (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-300">
              <AlertCircle className="h-3 w-3 mr-1" /> Overdue
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* PO workflow action buttons */}
      {canEdit && (data.status === "pending_approval" || data.status === "approved") && (
        <div className="flex flex-wrap gap-2">
          {data.status === "pending_approval" && (
            <Button size="sm" data-testid="approve-po" onClick={() => callTransition("approve")} disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Approve
            </Button>
          )}
          {data.status === "approved" && (
            <Button size="sm" data-testid="send-po" onClick={() => callTransition("send")} disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send to Supplier
            </Button>
          )}
        </div>
      )}
      {canEdit && (data.status === "partially_received" || data.status === "received") && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" data-testid="close-po" onClick={() => callTransition("close")} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Close PO
          </Button>
        </div>
      )}
      {can("procurement", "cancel") && !PO_TERMINAL.has(data.status) && data.status !== "closed" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" data-testid="cancel-po" onClick={() => callTransition("cancel")} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Cancel PO
          </Button>
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="supplier">Supplier</TabsTrigger>
          <TabsTrigger value="items">Items ({data.items.length})</TabsTrigger>
          <TabsTrigger value="project">Project</TabsTrigger>
          <TabsTrigger value="receiving">Receiving ({data.goodsReceipts.length})</TabsTrigger>
          <TabsTrigger value="finance">Finance / Handoff</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        {/* ============== OVERVIEW ============== */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Order Information</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="PO Number" value={data.purchaseOrderNumber} />
                <Row label="Status" value={<Badge variant="outline" className={PO_STATUS_BADGE[data.status] ?? ""}>{data.status.replace("_", " ")}</Badge>} />
                <Row label="Order Date" value={fmt(data.orderDate)} />
                <Row label="Expected Delivery" value={<span className={overdue ? "text-amber-600 font-medium" : ""}>{fmt(data.expectedDeliveryDate)}{overdue && <AlertCircle className="inline h-3 w-3 ml-1" />}</span>} />
                {data.sentAt && <Row label="Sent At" value={fmtDateTime(data.sentAt)} />}
                {data.closedAt && <Row label="Closed At" value={fmt(data.closedAt)} />}
                {data.cancelledAt && <Row label="Cancelled At" value={fmt(data.cancelledAt)} />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Financial Summary</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Subtotal" value={formatMoney(data.subtotal, currency)} />
                <Row label="Tax" value={formatMoney(data.tax, currency)} />
                <Row label="Total" value={<span className="text-base font-bold">{formatMoney(data.total, currency)}</span>} />
                <Row label="Currency" value={currency} />
                <div className="border-t pt-2 mt-2 space-y-2">
                  <Row label="Requested By" value={data.requestedBy?.username || "—"} />
                  {data.approvedBy && <Row label="Approved By" value={data.approvedBy.username} />}
                  {data.approvedAt && <Row label="Approved At" value={fmtDateTime(data.approvedAt)} />}
                </div>
              </CardContent>
            </Card>

            {data.notes && (
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
                <CardContent><p className="text-sm whitespace-pre-wrap">{data.notes}</p></CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ============== SUPPLIER ============== */}
        <TabsContent value="supplier" className="mt-4">
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
              <Row label="Email" value={data.supplier.email || "—"} />
              <Row label="Phone" value={data.supplier.phone || "—"} />
              <Row label="City" value={data.supplier.city || "—"} />
              <Row label="Country" value={data.supplier.country} />
              <Row label="Status" value={<Badge variant="outline" className="text-xs">{data.supplier.status}</Badge>} />
            </CardContent>
          </Card>
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
            <EmptyState icon={Package} title="No line items" description="Add items to this purchase order before sending it." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Tax %</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Received</TableHead>
                        <TableHead>Status</TableHead>
                        {itemsEditable && <TableHead></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((it) => (
                        <TableRow key={it.id}>
                          <TableCell className="text-sm font-medium">{it.description}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{Number(it.quantity).toLocaleString()}</TableCell>
                          <TableCell className="text-right text-xs">{formatMoney(it.unitPrice, currency)}</TableCell>
                          <TableCell className="text-right text-xs">{Number(it.taxRate).toFixed(2)}%</TableCell>
                          <TableCell className="text-right text-xs">{formatMoney(it.tax, currency)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{formatMoney(it.total, currency)}</TableCell>
                          <TableCell className="text-right text-xs">{Number(it.receivedQuantity).toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${ITEM_STATUS_BADGE[it.status] ?? ""}`}>
                              {it.status.replace("_", " ")}
                            </Badge>
                          </TableCell>
                          {itemsEditable && (
                            <TableCell>
                              <div className="flex gap-1 justify-end">
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditItem({ ...it })} disabled={busy}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600 hover:text-rose-700" onClick={() => handleDeleteItem(it.id)} disabled={busy}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {/* Totals footer */}
                <div className="border-t bg-muted/30 p-4">
                  <div className="ml-auto max-w-xs space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatMoney(String(itemsSubtotal.toFixed(2)), currency)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{formatMoney(String(itemsTax.toFixed(2)), currency)}</span></div>
                    <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span>{formatMoney(data.total, currency)}</span></div>
                  </div>
                </div>
              </CardContent>
            </Card>
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
                {data.procurementRequest && (
                  <>
                    <div className="border-t pt-2 mt-2" />
                    <Row label="Originating Request" value={`${data.procurementRequest.requestNumber} — ${data.procurementRequest.title}`} />
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <EmptyState icon={FolderKanban} title="Not linked to a project" description="This purchase order is not associated with a project." />
          )}
        </TabsContent>

        {/* ============== RECEIVING ============== */}
        <TabsContent value="receiving" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Boxes className="h-4 w-4" /> Goods Receipts
            </h3>
            {canReceiveItems && (
              <Button size="sm" data-testid="record-receipt-trigger" onClick={openReceiveDialog}>
                <Plus className="h-4 w-4" /> Record Receipt
              </Button>
            )}
          </div>

          {data.goodsReceipts.length === 0 ? (
            <EmptyState icon={Boxes} title="No receipts recorded" description={canReceiveItems ? "Click 'Record Receipt' when goods arrive." : "Receipts can be recorded once the PO has been sent."} />
          ) : (
            <div className="space-y-3">
              {data.goodsReceipts.map(r => (
                <Card key={r.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <span className="font-mono">{r.receiptNumber}</span>
                      <Badge variant="outline" className="text-xs">{r.status}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Row label="Receipt Date" value={fmt(r.receiptDate)} />
                      <Row label="Received By" value={r.receivedBy?.username || "—"} />
                    </div>
                    {r.notes && <p className="text-xs text-muted-foreground italic">{r.notes}</p>}
                    <div className="border-t pt-2">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead className="text-right">Received Qty</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {r.items.map(ri => (
                            <TableRow key={ri.id}>
                              <TableCell className="text-xs">{ri.purchaseOrderItem?.description || "—"}</TableCell>
                              <TableCell className="text-right text-xs font-mono">{Number(ri.receivedQuantity).toLocaleString()}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ============== FINANCE / HANDOFF ============== */}
        <TabsContent value="finance" className="mt-4">
          <Alert variant="default" className="border-amber-500/30 bg-amber-500/5">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-800 dark:text-amber-200">Financial Handoff (Deferred)</AlertTitle>
            <AlertDescription className="text-amber-800 dark:text-amber-200">
              <p className="mb-2">
                Purchase order totals shown above are <strong>commitments only</strong>, not posted liabilities.
                No Accounts Payable (AP) bill has been created in the Finance ledger.
              </p>
              <p className="mb-2">
                The Finance posting engine remains the <strong>authoritative source</strong> for all
                accounting entries. The handoff from procurement receipts to AP invoices is
                <strong> deferred to a future phase</strong>.
              </p>
              <p className="text-xs">
                When implemented, recording a supplier invoice against this PO will create a Journal
                entry (AP liability + expense/cost), with the PO referenced for reconciliation.
              </p>
            </AlertDescription>
          </Alert>

          <Card className="mt-4">
            <CardHeader><CardTitle className="text-sm">PO Commitment Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Subtotal (commitment)" value={formatMoney(data.subtotal, currency)} />
              <Row label="Tax (commitment)" value={formatMoney(data.tax, currency)} />
              <Row label="Total Commitment" value={<span className="font-bold">{formatMoney(data.total, currency)}</span>} />
              <Row label="AP Bill Posted" value={<Badge variant="outline" className="bg-amber-500/10 text-amber-700">Not Posted</Badge>} />
              <p className="text-xs text-muted-foreground pt-2 border-t">
                These figures represent the value committed to the supplier. They are NOT reflected
                in the general ledger until a supplier invoice is recorded in a future phase.
              </p>
            </CardContent>
          </Card>
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
                Audit trail available in the Audit Trail module. Every action on this purchase order
                (create, edit, approve, send, receive, close, cancel) and on its line items is
                recorded with the actor, timestamp, and previous/new values for full traceability.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ============== ADD ITEM DIALOG ============== */}
      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Add Line Item</DialogTitle>
            <DialogDescription>
              Add an item to PO {data.purchaseOrderNumber}. Tax and totals are calculated by the server.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="item-desc">Description</Label>
              <Input id="item-desc" value={iDesc} onChange={(e) => setIDesc(e.target.value)} placeholder="e.g. Office chair, model X-200" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="item-qty">Quantity</Label>
                <Input id="item-qty" inputMode="decimal" value={iQty} onChange={(e) => setIQty(e.target.value)} placeholder="e.g. 10" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="item-price">Unit Price</Label>
                <Input id="item-price" inputMode="decimal" value={iPrice} onChange={(e) => setIPrice(e.target.value)} placeholder="e.g. 850.00" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-tax">Tax Rate (%)</Label>
              <Input id="item-tax" inputMode="decimal" value={iTaxRate} onChange={(e) => setITaxRate(e.target.value)} placeholder="0" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setItemOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-item"
              onClick={handleAddItem}
              disabled={savingItem || !iDesc.trim() || !iQty || !iPrice}
            >
              {savingItem && <Loader2 className="h-4 w-4 animate-spin" />}
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== EDIT ITEM DIALOG ============== */}
      <Dialog open={!!editItem} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Edit Line Item</DialogTitle>
            <DialogDescription>Update the item details. Totals are recalculated by the server.</DialogDescription>
          </DialogHeader>
          {editItem && (
            <div className="grid gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-desc">Description</Label>
                <Input
                  id="edit-desc"
                  value={editItem.description}
                  onChange={(e) => setEditItem({ ...editItem, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-qty">Quantity</Label>
                  <Input
                    id="edit-qty"
                    inputMode="decimal"
                    value={editItem.quantity}
                    onChange={(e) => setEditItem({ ...editItem, quantity: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-price">Unit Price</Label>
                  <Input
                    id="edit-price"
                    inputMode="decimal"
                    value={editItem.unitPrice}
                    onChange={(e) => setEditItem({ ...editItem, unitPrice: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-tax">Tax Rate (%)</Label>
                <Input
                  id="edit-tax"
                  inputMode="decimal"
                  value={editItem.taxRate}
                  onChange={(e) => setEditItem({ ...editItem, taxRate: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-item-edit"
              onClick={handleSaveEdit}
              disabled={savingEdit || !editItem?.description.trim()}
            >
              {savingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== RECEIVE DIALOG ============== */}
      <Dialog open={recvOpen} onOpenChange={setRecvOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Record Goods Receipt</DialogTitle>
            <DialogDescription>
              Enter the quantities received in this shipment. Over-receipt is rejected by the server.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="recv-date">Receipt Date</Label>
                <Input id="recv-date" type="date" value={recvDate} onChange={(e) => setRecvDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recv-notes">Notes (optional)</Label>
                <Input id="recv-notes" value={recvNotes} onChange={(e) => setRecvNotes(e.target.value)} placeholder="Delivery notes…" />
              </div>
            </div>

            {receivableItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items are eligible for receiving on this PO.</p>
            ) : (
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Already Received</TableHead>
                      <TableHead className="text-right">This Receipt</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receivableItems.map(it => {
                      const remaining = Number(it.quantity) - Number(it.receivedQuantity);
                      return (
                        <TableRow key={it.id}>
                          <TableCell className="text-sm font-medium">{it.description}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{Number(it.quantity).toLocaleString()}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{Number(it.receivedQuantity).toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="any"
                              max={remaining}
                              className="h-8 w-24 ml-auto text-right"
                              placeholder="0"
                              value={recvLines[it.id] ?? ""}
                              onChange={(e) => setRecvLines(prev => ({ ...prev, [it.id]: e.target.value }))}
                            />
                            <p className="text-[10px] text-muted-foreground mt-0.5">{remaining.toLocaleString()} remaining</p>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRecvOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-receipt"
              onClick={handleReceive}
              disabled={savingRecv || receivableItems.length === 0}
            >
              {savingRecv && <Loader2 className="h-4 w-4 animate-spin" />}
              Record Receipt
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
