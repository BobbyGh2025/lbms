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
  Plus, Loader2, AlertCircle, CheckCircle2, XCircle, Send,
  ArrowRightLeft, Ban,
} from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/finance/money";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuoteItemLine {
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

interface QuoteDetail {
  id: string;
  quoteNumber: string;
  customerId: string;
  customer: {
    id: string; customerNumber: string;
    tradingName: string | null; legalName: string | null;
    firstName: string | null; lastName: string | null;
    email: string | null; phone: string | null;
    status: string; country: string; city: string | null;
  };
  projectId: string | null;
  project: { id: string; projectNumber: string; name: string; status: string } | null;
  issueDate: string;
  expiryDate: string | null;
  status: string;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  notes: string | null;
  terms: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  acceptedBy: { id: string; username: string } | null;
  convertedAt: string | null;
  convertedToSalesOrderId: string | null;
  createdBy: { id: string; username: string } | null;
  updatedBy: { id: string; username: string } | null;
  createdAt: string;
  updatedAt: string;
  items: QuoteItemLine[];
}

interface InventoryItemOption { id: string; label: string; }

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const QUOTE_STATUS_BADGE: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  sent: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  accepted: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  expired: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  converted: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  cancelled: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const QUOTE_TERMINAL = new Set(["rejected", "expired", "converted", "cancelled"]);

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

function customerLabel(c: QuoteDetail["customer"] | null) {
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

export function QuoteProfileView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { can } = useAuth();

  const [data, setData] = useState<QuoteDetail | null>(null);
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

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sales/quotes/${id}`);
        if (cancelled) return;
        if (res.status === 404) { setData(null); return; }
        if (!res.ok) { toast.error("Failed to load quote."); return; }
        setData(await res.json());
      } catch {
        if (!cancelled) toast.error("Failed to load quote.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Load inventory items when item dialog opens
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
      const res = await fetch(`/api/sales/quotes/${id}`);
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
  }

  async function callTransition(endpoint: string, successMsg: string) {
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/quotes/${id}/${endpoint}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to ${endpoint} quote.`);
      }
      toast.success(successMsg);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${endpoint} quote.`);
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
      const res = await fetch(`/api/sales/quotes/${id}/items`, {
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
        description="Choose a quote from the directory to view its profile."
        action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={FileText}
        title="Quote not found"
        description="This quote may have been removed."
        action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />
    );
  }

  const status = data.status;
  const canEdit = can("sales", "edit");
  const canSubmit = can("sales", "submit");
  const canApprove = can("sales", "approve");
  const canCancel = can("sales", "cancel");
  const itemsEditable = status === "draft" && canEdit;

  const itemsSubtotal = data.items.reduce(
    (acc, it) => acc + Number(it.quantity) * Number(it.unitPrice) - Number(it.discount || 0), 0,
  );
  const itemsTax = data.items.reduce((acc, it) => acc + Number(it.tax || 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.quoteNumber}
        description={`Customer: ${customerLabel(data.customer)}`}
        action={<Button variant="outline" onClick={back}><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />

      {/* Header summary card */}
      <Card>
        <CardContent className="p-4 sm:p-6 flex flex-wrap items-center gap-3">
          <Badge variant="outline" className={QUOTE_STATUS_BADGE[status] ?? ""}>
            {status.replace("_", " ")}
          </Badge>
          <div className="text-sm">
            <span className="text-muted-foreground">Total: </span>
            <span className="font-semibold">{money(data.total)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Issued <span className="font-medium">{fmt(data.issueDate)}</span>
          </div>
          {data.expiryDate && (
            <div className="text-xs text-muted-foreground">
              Expires <span className="font-medium">{fmt(data.expiryDate)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action buttons */}
      {status === "draft" && canSubmit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" data-testid="send-quote" onClick={() => callTransition("send", "Quote sent to customer.")} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
          </Button>
        </div>
      )}
      {status === "sent" && canApprove && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" data-testid="accept-quote" onClick={() => callTransition("accept", "Quote accepted.")} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Accept
          </Button>
          <Button size="sm" variant="outline" data-testid="reject-quote" onClick={() => callTransition("reject", "Quote rejected.")} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Reject
          </Button>
        </div>
      )}
      {status === "accepted" && canApprove && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" data-testid="convert-quote" onClick={() => callTransition("convert", "Quote converted to sales order.")} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />} Convert to Order
          </Button>
        </div>
      )}
      {canCancel && !QUOTE_TERMINAL.has(status) && status !== "converted" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" data-testid="cancel-quote" onClick={() => callTransition("cancel", "Quote cancelled.")} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Cancel
          </Button>
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="items">Items ({data.items.length})</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        {/* ============== OVERVIEW ============== */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Quote Information</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row label="Quote Number" value={data.quoteNumber} />
                <Row label="Status" value={<Badge variant="outline" className={QUOTE_STATUS_BADGE[status] ?? ""}>{status.replace("_", " ")}</Badge>} />
                <Row label="Issue Date" value={fmt(data.issueDate)} />
                <Row label="Expiry Date" value={fmt(data.expiryDate)} />
                {data.sentAt && <Row label="Sent At" value={fmtDateTime(data.sentAt)} />}
                {data.acceptedAt && <Row label="Accepted At" value={fmtDateTime(data.acceptedAt)} />}
                {data.convertedAt && <Row label="Converted At" value={fmtDateTime(data.convertedAt)} />}
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
                  <Row label="Customer" value={customerLabel(data.customer)} />
                  {data.acceptedBy && <Row label="Accepted By" value={data.acceptedBy.username} />}
                  {data.createdBy && <Row label="Created By" value={data.createdBy.username} />}
                </div>
              </CardContent>
            </Card>

            {data.notes && (
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
                <CardContent><p className="text-sm whitespace-pre-wrap">{data.notes}</p></CardContent>
              </Card>
            )}

            {data.terms && (
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="text-sm">Terms & Conditions</CardTitle></CardHeader>
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
            <EmptyState icon={Package} title="No line items" description="Add items to this quote before sending it." />
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
                Full audit trail (every transition: create, send, accept, reject, cancel, convert)
                is available in the Audit Trail module with actor, timestamp, and previous/new values
                for full traceability.
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
              <Input id="i-desc" value={iDesc} onChange={(e) => setIDesc(e.target.value)} placeholder="e.g. Design services" />
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
              data-testid="submit-quote-item"
              onClick={handleAddItem}
              disabled={savingItem || !iDesc.trim() || !iQty || !iPrice}
            >
              {savingItem && <Loader2 className="h-4 w-4 animate-spin" />}
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
