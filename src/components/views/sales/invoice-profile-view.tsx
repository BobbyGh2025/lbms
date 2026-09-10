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
  ArrowLeft, Receipt, ShieldCheck, FolderKanban, Package,
  Plus, Loader2, AlertCircle, Ban, Send, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/finance/money";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InvoiceItemLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRate: string;
  tax: string;
  total: string;
  inventoryItem?: {
    id: string; itemCode: string; name: string; unitOfMeasure: string | null;
  } | null;
}

interface InvoicePayment {
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

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customer: {
    id: string; customerNumber: string;
    tradingName: string | null; legalName: string | null;
    firstName: string | null; lastName: string | null;
    email: string | null; phone: string | null;
    status: string; country: string; city: string | null;
  };
  salesOrderId: string | null;
  salesOrder: { id: string; orderNumber: string; status: string } | null;
  projectId: string | null;
  project: { id: string; projectNumber: string; name: string; status: string } | null;
  issueDate: string;
  dueDate: string;
  status: string;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  notes: string | null;
  terms: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  createdBy: { id: string; username: string } | null;
  updatedBy: { id: string; username: string } | null;
  createdAt: string;
  updatedAt: string;
  overdue: boolean;
  items: InvoiceItemLine[];
  payments: InvoicePayment[];
}

interface InventoryItemOption { id: string; label: string; }

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const INVOICE_STATUS_BADGE: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  issued: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  partially_paid: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  paid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  voided: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const PAYMENT_STATUS_BADGE: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  posted: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  voided: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const INVOICE_TERMINAL = new Set(["voided"]);

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

function customerLabel(c: InvoiceDetail["customer"] | null) {
  if (!c) return "—";
  return c.tradingName || c.legalName
    || [c.firstName, c.lastName].filter(Boolean).join(" ")
    || c.customerNumber;
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

export function InvoiceProfileView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { can } = useAuth();

  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Add item dialog
  const [itemOpen, setItemOpen] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [iDesc, setIDesc] = useState("");
  const [iQty, setIQty] = useState("");
  const [iPrice, setIPrice] = useState("");
  const [iDiscount, setIDiscount] = useState("");
  const [iTaxRate, setITaxRate] = useState("0");
  const [iItemId, setIItemId] = useState("");
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([]);

  // Record payment dialog
  const [payOpen, setPayOpen] = useState(false);
  const [savingPay, setSavingPay] = useState(false);
  const [pAmount, setPAmount] = useState("");
  const [pMethod, setPMethod] = useState("cash");
  const [pReference, setPReference] = useState("");
  const [pDate, setPDate] = useState("");
  const [pNotes, setPNotes] = useState("");

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sales/invoices/${id}`);
        if (cancelled) return;
        if (res.status === 404) { setData(null); return; }
        if (!res.ok) { toast.error("Failed to load invoice."); return; }
        setData(await res.json());
      } catch {
        if (!cancelled) toast.error("Failed to load invoice.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!itemOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/inventory/items?pageSize=100");
        if (cancelled) return;
        if (!res.ok) return;
        const data = await res.json();
        setInventoryItems((data.items ?? []).map((x: any) => ({
          id: x.id,
          label: `${x.itemCode} — ${x.name}`,
        })));
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [itemOpen]);

  function back() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "sales");
    params.delete("id");
    router.push(`?${params.toString()}`);
  }

  async function refresh() {
    if (!id) return;
    try {
      const res = await fetch(`/api/sales/invoices/${id}`);
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
  }

  async function callTransition(endpoint: string, successMsg: string) {
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/invoices/${id}/${endpoint}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to ${endpoint} invoice.`);
      }
      toast.success(successMsg);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${endpoint} invoice.`);
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
      const res = await fetch(`/api/sales/invoices/${id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: iDesc.trim(),
          quantity: iQty,
          unitPrice: iPrice,
          discount: iDiscount || "0",
          taxRate: iTaxRate || "0",
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
      setIDiscount(""); setITaxRate("0"); setIItemId("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add item.");
    } finally {
      setSavingItem(false);
    }
  }

  async function handleRecordPayment() {
    if (!data) return;
    if (!pAmount || Number(pAmount) <= 0) {
      toast.error("Amount must be greater than zero."); return;
    }
    // Overpayment guard (client-side; server enforces too).
    if (Number(pAmount) > Number(data.balanceDue)) {
      toast.error(`Amount exceeds balance due (${money(data.balanceDue)}).`);
      return;
    }
    setSavingPay(true);
    try {
      const res = await fetch("/api/sales/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: data.customerId,
          invoiceId: data.id,
          amount: pAmount,
          paymentMethod: pMethod,
          reference: pReference.trim() || undefined,
          notes: pNotes.trim() || undefined,
          paymentDate: pDate || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to record payment.");
      }
      const created = await res.json();
      toast.success(`Payment recorded: ${created.paymentNumber} (draft — post it to apply).`);
      setPayOpen(false);
      setPAmount(""); setPMethod("cash"); setPReference(""); setPNotes(""); setPDate("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record payment.");
    } finally {
      setSavingPay(false);
    }
  }

  async function handlePostPayment(paymentId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/payments/${paymentId}/post`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to post payment.");
      }
      toast.success("Payment posted. Invoice balance updated.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post payment.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVoidPayment(paymentId: string) {
    if (!confirm("Void this payment? This will reverse the linked journal entry.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/payments/${paymentId}/void`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to void payment.");
      }
      toast.success("Payment voided. Journal reversed.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to void payment.");
    } finally {
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
        icon={Receipt}
        title="No record selected"
        description="Choose an invoice from the directory to view its profile."
        action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={Receipt}
        title="Invoice not found"
        description="This invoice may have been removed."
        action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />
    );
  }

  const status = data.status;
  const canEdit = can("sales", "edit");
  const canIssue = can("sales", "issue");
  const canPay = can("sales", "pay");
  const canVoid = can("sales", "void");
  const itemsEditable = status === "draft" && canEdit;
  const canRecordPayment = (status === "issued" || status === "partially_paid") && canPay;
  const canIssueInvoice = status === "draft" && canIssue;
  const canVoidInvoice = !INVOICE_TERMINAL.has(status) && status !== "draft" && canVoid;

  const itemsSubtotal = data.items.reduce(
    (acc, it) => acc + Number(it.quantity) * Number(it.unitPrice) - Number(it.discount || 0), 0,
  );
  const itemsTax = data.items.reduce((acc, it) => acc + Number(it.tax || 0), 0);

  // Default amount when opening payment dialog = full balance
  function openPayDialog() {
    setPAmount(data?.balanceDue || "");
    setPMethod("cash");
    setPReference("");
    setPNotes("");
    setPDate(new Date().toISOString().slice(0, 10));
    setPayOpen(true);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.invoiceNumber}
        description={`Customer: ${customerLabel(data.customer)}`}
        action={<Button variant="outline" onClick={back}><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />

      {/* Header summary card */}
      <Card>
        <CardContent className="p-4 sm:p-6 flex flex-wrap items-center gap-3">
          <Badge variant="outline" className={INVOICE_STATUS_BADGE[status] ?? ""}>
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

      {/* Action buttons */}
      {canIssueInvoice && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" data-testid="issue-invoice" onClick={() => callTransition("issue", "Invoice issued to customer.")} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Issue
          </Button>
        </div>
      )}
      {canVoidInvoice && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" data-testid="void-invoice" onClick={() => callTransition("void", "Invoice voided.")} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Void
          </Button>
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
              <CardHeader><CardTitle className="text-sm">Invoice Information</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row label="Invoice Number" value={data.invoiceNumber} />
                <Row label="Status" value={<Badge variant="outline" className={INVOICE_STATUS_BADGE[status] ?? ""}>{status.replace("_", " ")}</Badge>} />
                <Row label="Issue Date" value={fmt(data.issueDate)} />
                <Row label="Due Date" value={
                  <span className={data.overdue ? "text-rose-600 font-medium" : ""}>
                    {fmt(data.dueDate)}{data.overdue && <AlertCircle className="inline h-3 w-3 ml-1" />}
                  </span>
                } />
                {data.salesOrder && (
                  <Row label="Sales Order" value={<span className="font-mono text-xs">{data.salesOrder.orderNumber}</span>} />
                )}
                {data.issuedAt && <Row label="Issued At" value={fmtDateTime(data.issuedAt)} />}
                {data.voidedAt && <Row label="Voided At" value={fmtDateTime(data.voidedAt)} />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Financial Summary</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row label="Subtotal" value={money(data.subtotal)} />
                <Row label="Discount" value={money(data.discount)} />
                <Row label="Tax" value={money(data.tax)} />
                <Row label="Total" value={<span className="text-base font-bold">{money(data.total)}</span>} />
                <div className="border-t pt-2 mt-2 space-y-1">
                  <Row label="Amount Paid" value={<span className="text-emerald-600 font-medium">{money(data.amountPaid)}</span>} />
                  <Row label="Balance Due" value={<span className="text-rose-600 font-bold">{money(data.balanceDue)}</span>} />
                  <Row label="Customer" value={customerLabel(data.customer)} />
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

            {data.terms && (
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="text-sm">Terms</CardTitle></CardHeader>
                <CardContent><p className="text-sm whitespace-pre-wrap">{data.terms}</p></CardContent>
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
            <EmptyState icon={Package} title="No line items" description="Add items to this invoice before issuing it." />
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
                        <TableHead className="text-right">Discount</TableHead>
                        <TableHead className="text-right">Tax %</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
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
                          <TableCell className="text-right text-xs font-mono">{Number(it.quantity).toLocaleString()}</TableCell>
                          <TableCell className="text-right text-xs">{money(it.unitPrice)}</TableCell>
                          <TableCell className="text-right text-xs">{money(it.discount)}</TableCell>
                          <TableCell className="text-right text-xs">{Number(it.taxRate).toFixed(2)}%</TableCell>
                          <TableCell className="text-right text-xs">{money(it.tax)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{money(it.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="border-t bg-muted/30 p-4">
                  <div className="ml-auto max-w-xs space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{money(String(itemsSubtotal.toFixed(2)))}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{money(String(itemsTax.toFixed(2)))}</span></div>
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
              <Wallet className="h-4 w-4" /> Customer Payments
            </h3>
            {canRecordPayment && (
              <Button size="sm" data-testid="record-payment-trigger" onClick={openPayDialog}>
                <Plus className="h-4 w-4" /> Record Payment
              </Button>
            )}
          </div>

          {data.payments.length === 0 ? (
            <EmptyState icon={Wallet} title="No payments" description={canRecordPayment ? "Click 'Record Payment' to receive funds against this invoice." : "Payments can be recorded once the invoice is issued."} />
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
                        <TableHead className="text-right">Actions</TableHead>
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
                          <TableCell className="text-right">
                            {p.status === "draft" && canPay && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7"
                                data-testid={`post-payment-${p.id}`}
                                onClick={() => handlePostPayment(p.id)}
                                disabled={busy}
                              >
                                Post
                              </Button>
                            )}
                            {p.status === "posted" && canVoid && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-rose-600 hover:text-rose-700"
                                data-testid={`void-payment-${p.id}`}
                                onClick={() => handleVoidPayment(p.id)}
                                disabled={busy}
                              >
                                Void
                              </Button>
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
              </div>
              <p className="text-muted-foreground">
                Full audit trail (every transition: create, issue, void, payment post/void)
                is available in the Audit Trail module with actor, timestamp, and previous/new values.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
              <Input id="i-desc" value={iDesc} onChange={(e) => setIDesc(e.target.value)} placeholder="e.g. Consulting services" />
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="i-disc">Discount (flat)</Label>
                <Input id="i-disc" inputMode="decimal" value={iDiscount} onChange={(e) => setIDiscount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="i-tax">Tax Rate (%)</Label>
                <Input id="i-tax" inputMode="decimal" value={iTaxRate} onChange={(e) => setITaxRate(e.target.value)} placeholder="0" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setItemOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-invoice-item"
              onClick={handleAddItem}
              disabled={savingItem || !iDesc.trim() || !iQty || !iPrice}
            >
              {savingItem && <Loader2 className="h-4 w-4 animate-spin" />}
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== RECORD PAYMENT DIALOG ============== */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              Invoice {data.invoiceNumber} · Balance due {money(data.balanceDue)}. Payment will be created as draft — post it to apply.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-amount">Amount *</Label>
                <Input id="p-amount" inputMode="decimal" value={pAmount} onChange={(e) => setPAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Payment Method</Label>
                <Select value={pMethod} onValueChange={setPMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="mobile_money">Mobile Money</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-ref">Reference</Label>
                <Input id="p-ref" value={pReference} onChange={(e) => setPReference(e.target.value)} placeholder="Cheque #, Momo ID…" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-date">Payment Date</Label>
                <Input id="p-date" type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-notes">Notes</Label>
              <Textarea id="p-notes" value={pNotes} onChange={(e) => setPNotes(e.target.value)} rows={2} placeholder="Optional notes…" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-invoice-payment"
              onClick={handleRecordPayment}
              disabled={savingPay || !pAmount || Number(pAmount) <= 0}
            >
              {savingPay && <Loader2 className="h-4 w-4 animate-spin" />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
