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
import {
  FileText, Receipt, ShoppingCart, Wallet, Plus, Loader2,
  ChevronRight, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/finance/money";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CustomerOption { id: string; label: string; }
interface ProjectOption { id: string; label: string; }
interface InventoryItemOption { id: string; label: string; }
interface QuoteOption { id: string; label: string; }
interface InvoiceOption { id: string; label: string; balance: string; }

interface QuoteListItem {
  id: string;
  quoteNumber: string;
  customerId: string;
  customer: {
    id: string; customerNumber?: string;
    tradingName?: string | null; legalName?: string | null;
    firstName?: string | null; lastName?: string | null;
  } | null;
  projectId: string | null;
  project?: { id: string; projectNumber: string; name: string } | null;
  issueDate: string;
  expiryDate: string | null;
  status: string;
  total: string;
  _count?: { items: number };
}

interface OrderListItem {
  id: string;
  orderNumber: string;
  customerId: string;
  customer: {
    id: string; customerNumber?: string;
    tradingName?: string | null; legalName?: string | null;
    firstName?: string | null; lastName?: string | null;
  } | null;
  quoteId: string | null;
  quote?: { id: string; quoteNumber: string } | null;
  projectId: string | null;
  project?: { id: string; projectNumber: string; name: string } | null;
  orderDate: string;
  status: string;
  total: string;
  _count?: { items: number; invoices: number };
}

interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customer: {
    id: string; customerNumber?: string;
    tradingName?: string | null; legalName?: string | null;
    firstName?: string | null; lastName?: string | null;
  } | null;
  salesOrderId: string | null;
  salesOrder?: { id: string; orderNumber: string; status: string } | null;
  projectId: string | null;
  project?: { id: string; projectNumber: string; name: string } | null;
  issueDate: string;
  dueDate: string;
  status: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  overdue: boolean;
  _count?: { items: number; payments: number };
}

interface PaymentListItem {
  id: string;
  paymentNumber: string;
  customerId: string;
  customer: {
    id: string; customerNumber?: string;
    tradingName?: string | null; legalName?: string | null;
    firstName?: string | null; lastName?: string | null;
  } | null;
  invoiceId: string | null;
  invoice?: { id: string; invoiceNumber: string; status: string } | null;
  amount: string;
  paymentMethod: string;
  reference: string | null;
  status: string;
  paymentDate: string;
}

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

const ORDER_STATUS_BADGE: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  confirmed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  processing: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  completed: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  cancelled: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function customerLabel(c: QuoteListItem["customer"]) {
  if (!c) return "—";
  return c.tradingName || c.legalName
    || [c.firstName, c.lastName].filter(Boolean).join(" ")
    || c.customerNumber || "—";
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short", day: "2-digit", year: "numeric",
    });
  } catch { return "—"; }
}

function money(v: string | null | undefined): string {
  if (!v) return "GHS 0.00";
  return formatMoney(v, "GHS");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SalesView() {
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("quotes");

  // =============== Quotes ===============
  const [quotes, setQuotes] = useState<QuoteListItem[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [searchQuotes, setSearchQuotes] = useState("");
  const [statusQuotes, setStatusQuotes] = useState("all");

  // =============== Sales Orders ===============
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [searchOrders, setSearchOrders] = useState("");
  const [statusOrders, setStatusOrders] = useState("all");

  // =============== Invoices ===============
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [searchInvoices, setSearchInvoices] = useState("");
  const [statusInvoices, setStatusInvoices] = useState("all");

  // =============== Payments ===============
  const [payments, setPayments] = useState<PaymentListItem[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [searchPayments, setSearchPayments] = useState("");
  const [statusPayments, setStatusPayments] = useState("all");

  // Reference data
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([]);
  const [quotesRef, setQuotesRef] = useState<QuoteOption[]>([]);
  const [ordersRef, setOrdersRef] = useState<{ id: string; label: string }[]>([]);
  const [invoicesRef, setInvoicesRef] = useState<InvoiceOption[]>([]);
  const [refLoaded, setRefLoaded] = useState(false);

  // Dialog state
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [savingQuote, setSavingQuote] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);

  // Quote form
  const [qCustomerId, setQCustomerId] = useState("");
  const [qProjectId, setQProjectId] = useState("");
  const [qExpiry, setQExpiry] = useState("");
  const [qNotes, setQNotes] = useState("");
  const [qTerms, setQTerms] = useState("");

  // Order form
  const [oCustomerId, setOCustomerId] = useState("");
  const [oQuoteId, setOQuoteId] = useState("");
  const [oProjectId, setOProjectId] = useState("");
  const [oNotes, setONotes] = useState("");

  // Invoice form
  const [iCustomerId, setICustomerId] = useState("");
  const [iSalesOrderId, setISalesOrderId] = useState("");
  const [iProjectId, setIProjectId] = useState("");
  const [iDueDate, setIDueDate] = useState("");
  const [iNotes, setINotes] = useState("");
  const [iTerms, setITerms] = useState("");

  // Payment form
  const [pCustomerId, setPCustomerId] = useState("");
  const [pInvoiceId, setPInvoiceId] = useState("");
  const [pAmount, setPAmount] = useState("");
  const [pMethod, setPMethod] = useState("cash");
  const [pReference, setPReference] = useState("");
  const [pNotes, setPNotes] = useState("");
  const [pDate, setPDate] = useState("");

  // ----- Fetchers -----
  const fetchQuotes = useCallback(async () => {
    try {
      setLoadingQuotes(true);
      const params = new URLSearchParams({ pageSize: "50" });
      if (searchQuotes) params.set("search", searchQuotes);
      if (statusQuotes !== "all") params.set("status", statusQuotes);
      const res = await fetch(`/api/sales/quotes?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setQuotes(data.items ?? []);
    } catch {
      toast.error("Failed to load quotations.");
    } finally {
      setLoadingQuotes(false);
    }
  }, [searchQuotes, statusQuotes]);

  const fetchOrders = useCallback(async () => {
    try {
      setLoadingOrders(true);
      const params = new URLSearchParams({ pageSize: "50" });
      if (searchOrders) params.set("search", searchOrders);
      if (statusOrders !== "all") params.set("status", statusOrders);
      const res = await fetch(`/api/sales/orders?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setOrders(data.items ?? []);
    } catch {
      toast.error("Failed to load sales orders.");
    } finally {
      setLoadingOrders(false);
    }
  }, [searchOrders, statusOrders]);

  const fetchInvoices = useCallback(async () => {
    try {
      setLoadingInvoices(true);
      const params = new URLSearchParams({ pageSize: "50" });
      if (searchInvoices) params.set("search", searchInvoices);
      if (statusInvoices !== "all") params.set("status", statusInvoices);
      const res = await fetch(`/api/sales/invoices?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setInvoices(data.items ?? []);
    } catch {
      toast.error("Failed to load invoices.");
    } finally {
      setLoadingInvoices(false);
    }
  }, [searchInvoices, statusInvoices]);

  const fetchPayments = useCallback(async () => {
    try {
      setLoadingPayments(true);
      const params = new URLSearchParams({ pageSize: "50" });
      if (searchPayments) params.set("search", searchPayments);
      if (statusPayments !== "all") params.set("status", statusPayments);
      const res = await fetch(`/api/sales/payments?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setPayments(data.items ?? []);
    } catch {
      toast.error("Failed to load payments.");
    } finally {
      setLoadingPayments(false);
    }
  }, [searchPayments, statusPayments]);

  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);
  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);
  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  // Load reference data on first dialog open
  useEffect(() => {
    if (!quoteOpen && !orderOpen && !invoiceOpen && !paymentOpen) return;
    if (refLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const [cRes, pRes, iRes] = await Promise.all([
          fetch("/api/customers?pageSize=100"),
          fetch("/api/projects?pageSize=100"),
          fetch("/api/inventory/items?pageSize=100").catch(() => null),
        ]);
        if (cancelled) return;
        const c = cRes.ok ? await cRes.json() : { items: [] };
        const p = pRes.ok ? await pRes.json() : { items: [] };
        setCustomers((c.items ?? []).map((x: any) => ({
          id: x.id,
          label: x.tradingName || x.legalName
            || [x.firstName, x.lastName].filter(Boolean).join(" ")
            || x.customerNumber || x.id,
        })));
        setProjects((p.items ?? []).map((x: any) => ({
          id: x.id,
          label: `${x.projectNumber} — ${x.name}`,
        })));
        if (iRes && iRes.ok) {
          const inv = await iRes.json();
          setInventoryItems((inv.items ?? []).map((x: any) => ({
            id: x.id,
            label: `${x.itemCode} — ${x.name}`,
          })));
        }
        setRefLoaded(true);
      } catch {
        /* silent */
      }
    })();
    return () => { cancelled = true; };
  }, [quoteOpen, orderOpen, invoiceOpen, paymentOpen, refLoaded]);

  // When invoice dialog opens, fetch issued/partially_paid invoices for selection
  useEffect(() => {
    if (!paymentOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sales/invoices?pageSize=100&status=issued`);
        if (cancelled) return;
        if (!res.ok) return;
        const data = await res.json();
        setInvoicesRef((data.items ?? []).map((x: any) => ({
          id: x.id,
          label: x.invoiceNumber,
          balance: x.balanceDue,
        })));
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [paymentOpen]);

  // When order dialog opens, fetch accepted quotes for selection
  useEffect(() => {
    if (!orderOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sales/quotes?pageSize=100&status=accepted`);
        if (cancelled) return;
        if (!res.ok) return;
        const data = await res.json();
        setQuotesRef((data.items ?? []).map((x: any) => ({
          id: x.id,
          label: x.quoteNumber,
        })));
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [orderOpen]);

  // When invoice dialog opens, fetch confirmed orders for selection
  useEffect(() => {
    if (!invoiceOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sales/orders?pageSize=100&status=confirmed`);
        if (cancelled) return;
        if (!res.ok) return;
        const data = await res.json();
        setOrdersRef((data.items ?? []).map((x: any) => ({
          id: x.id,
          label: x.orderNumber,
        })));
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [invoiceOpen]);

  // ----- Navigation -----
  function go(view: string, id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    params.set("id", id);
    router.push(`?${params.toString()}`);
  }

  // ----- Submit handlers -----
  async function handleCreateQuote() {
    if (!qCustomerId) { toast.error("Customer is required."); return; }
    setSavingQuote(true);
    try {
      const res = await fetch("/api/sales/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: qCustomerId,
          projectId: qProjectId || undefined,
          expiryDate: qExpiry || undefined,
          notes: qNotes.trim() || undefined,
          terms: qTerms.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create quote.");
      }
      const created = await res.json();
      toast.success(`Quote created: ${created.quoteNumber}`);
      setQuoteOpen(false);
      setQCustomerId(""); setQProjectId(""); setQExpiry("");
      setQNotes(""); setQTerms("");
      fetchQuotes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create quote.");
    } finally {
      setSavingQuote(false);
    }
  }

  async function handleCreateOrder() {
    if (!oCustomerId) { toast.error("Customer is required."); return; }
    setSavingOrder(true);
    try {
      const res = await fetch("/api/sales/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: oCustomerId,
          quoteId: oQuoteId || undefined,
          projectId: oProjectId || undefined,
          notes: oNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create sales order.");
      }
      const created = await res.json();
      toast.success(`Sales order created: ${created.orderNumber}`);
      setOrderOpen(false);
      setOCustomerId(""); setOQuoteId(""); setOProjectId(""); setONotes("");
      fetchOrders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create sales order.");
    } finally {
      setSavingOrder(false);
    }
  }

  async function handleCreateInvoice() {
    if (!iCustomerId) { toast.error("Customer is required."); return; }
    if (!iDueDate) { toast.error("Due date is required."); return; }
    setSavingInvoice(true);
    try {
      const res = await fetch("/api/sales/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: iCustomerId,
          salesOrderId: iSalesOrderId || undefined,
          projectId: iProjectId || undefined,
          dueDate: iDueDate,
          notes: iNotes.trim() || undefined,
          terms: iTerms.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create invoice.");
      }
      const created = await res.json();
      toast.success(`Invoice created: ${created.invoiceNumber}`);
      setInvoiceOpen(false);
      setICustomerId(""); setISalesOrderId(""); setIProjectId("");
      setIDueDate(""); setINotes(""); setITerms("");
      fetchInvoices();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create invoice.");
    } finally {
      setSavingInvoice(false);
    }
  }

  async function handleCreatePayment() {
    if (!pCustomerId) { toast.error("Customer is required."); return; }
    if (!pAmount || Number(pAmount) <= 0) {
      toast.error("Amount must be greater than zero."); return;
    }
    setSavingPayment(true);
    try {
      const res = await fetch("/api/sales/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: pCustomerId,
          invoiceId: pInvoiceId || undefined,
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
      toast.success(`Payment recorded: ${created.paymentNumber} (draft)`);
      setPaymentOpen(false);
      setPCustomerId(""); setPInvoiceId(""); setPAmount("");
      setPMethod("cash"); setPReference(""); setPNotes(""); setPDate("");
      fetchPayments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record payment.");
    } finally {
      setSavingPayment(false);
    }
  }

  // ----- Render -----
  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales"
        description="Quotations, orders, invoices and payments."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="quotes">Quotations</TabsTrigger>
          <TabsTrigger value="orders">Sales Orders</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>

        {/* =============== QUOTATIONS TAB =============== */}
        <TabsContent value="quotes" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="Search by quote #…"
                value={searchQuotes}
                onChange={(e) => setSearchQuotes(e.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={statusQuotes} onValueChange={setStatusQuotes}>
                <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {can("sales", "create") && (
              <Button onClick={() => setQuoteOpen(true)}>
                <Plus className="h-4 w-4" /> New Quote
              </Button>
            )}
          </div>

          {loadingQuotes ? (
            <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : quotes.length === 0 ? (
            <EmptyState icon={FileText} title="No quotations" description="Create your first quote to get started." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Quote #</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Issue Date</TableHead>
                        <TableHead>Expiry</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quotes.map((q) => (
                        <TableRow
                          key={q.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => go("quote-profile", q.id)}
                        >
                          <TableCell className="font-mono text-xs">{q.quoteNumber}</TableCell>
                          <TableCell className="text-sm font-medium">{customerLabel(q.customer)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={QUOTE_STATUS_BADGE[q.status] ?? ""}>
                              {q.status.replace("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">{money(q.total)}</TableCell>
                          <TableCell className="text-xs">{fmt(q.issueDate)}</TableCell>
                          <TableCell className="text-xs">{fmt(q.expiryDate)}</TableCell>
                          <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* =============== SALES ORDERS TAB =============== */}
        <TabsContent value="orders" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="Search by order #…"
                value={searchOrders}
                onChange={(e) => setSearchOrders(e.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={statusOrders} onValueChange={setStatusOrders}>
                <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {can("sales", "create") && (
              <Button onClick={() => setOrderOpen(true)}>
                <Plus className="h-4 w-4" /> New Order
              </Button>
            )}
          </div>

          {loadingOrders ? (
            <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : orders.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="No sales orders" description="Create your first sales order to get started." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order #</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Order Date</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((o) => (
                        <TableRow
                          key={o.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => go("sales-order-profile", o.id)}
                        >
                          <TableCell className="font-mono text-xs">{o.orderNumber}</TableCell>
                          <TableCell className="text-sm font-medium">{customerLabel(o.customer)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={ORDER_STATUS_BADGE[o.status] ?? ""}>
                              {o.status.replace("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">{money(o.total)}</TableCell>
                          <TableCell className="text-xs">{fmt(o.orderDate)}</TableCell>
                          <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* =============== INVOICES TAB =============== */}
        <TabsContent value="invoices" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="Search by invoice #…"
                value={searchInvoices}
                onChange={(e) => setSearchInvoices(e.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={statusInvoices} onValueChange={setStatusInvoices}>
                <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="issued">Issued</SelectItem>
                  <SelectItem value="partially_paid">Partially Paid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="voided">Voided</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {can("sales", "create") && (
              <Button onClick={() => setInvoiceOpen(true)}>
                <Plus className="h-4 w-4" /> New Invoice
              </Button>
            )}
          </div>

          {loadingInvoices ? (
            <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : invoices.length === 0 ? (
            <EmptyState icon={Receipt} title="No invoices" description="Create your first invoice to get started." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Overdue</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((inv) => (
                        <TableRow
                          key={inv.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => go("invoice-profile", inv.id)}
                        >
                          <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                          <TableCell className="text-sm font-medium">{customerLabel(inv.customer)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={INVOICE_STATUS_BADGE[inv.status] ?? ""}>
                              {inv.status.replace("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {inv.overdue ? (
                              <Badge variant="outline" className="bg-rose-500/10 text-rose-700 dark:text-rose-300">
                                <AlertCircle className="h-3 w-3 mr-1" /> OVERDUE
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs">{money(inv.total)}</TableCell>
                          <TableCell className="text-right text-xs">{money(inv.amountPaid)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{money(inv.balanceDue)}</TableCell>
                          <TableCell className="text-xs">
                            <span className={inv.overdue ? "text-rose-600 font-medium" : ""}>
                              {fmt(inv.dueDate)}
                            </span>
                          </TableCell>
                          <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* =============== PAYMENTS TAB =============== */}
        <TabsContent value="payments" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="Search by payment #…"
                value={searchPayments}
                onChange={(e) => setSearchPayments(e.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={statusPayments} onValueChange={setStatusPayments}>
                <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="posted">Posted</SelectItem>
                  <SelectItem value="voided">Voided</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {can("sales", "pay") && (
              <Button onClick={() => setPaymentOpen(true)}>
                <Plus className="h-4 w-4" /> New Payment
              </Button>
            )}
          </div>

          {loadingPayments ? (
            <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : payments.length === 0 ? (
            <EmptyState icon={Wallet} title="No payments" description="Record your first customer payment to get started." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Payment #</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Invoice</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">{p.paymentNumber}</TableCell>
                          <TableCell className="text-sm font-medium">{customerLabel(p.customer)}</TableCell>
                          <TableCell className="font-mono text-xs">{p.invoice?.invoiceNumber || "—"}</TableCell>
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
      </Tabs>

      {/* =============== CREATE QUOTE DIALOG =============== */}
      <Dialog open={quoteOpen} onOpenChange={setQuoteOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>New Quote</DialogTitle>
            <DialogDescription>Create a draft quotation for a customer.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Select value={qCustomerId} onValueChange={setQCustomerId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (<SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Project (optional)</Label>
                <Select value={qProjectId} onValueChange={setQProjectId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="q-expiry">Expiry Date</Label>
                <Input id="q-expiry" type="date" value={qExpiry} onChange={(e) => setQExpiry(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="q-notes">Notes</Label>
              <Textarea id="q-notes" value={qNotes} onChange={(e) => setQNotes(e.target.value)} rows={2} placeholder="Optional internal notes…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="q-terms">Terms & Conditions</Label>
              <Textarea id="q-terms" value={qTerms} onChange={(e) => setQTerms(e.target.value)} rows={2} placeholder="Payment terms, validity, etc." />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setQuoteOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-quote"
              onClick={handleCreateQuote}
              disabled={savingQuote || !qCustomerId}
            >
              {savingQuote && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =============== CREATE ORDER DIALOG =============== */}
      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>New Sales Order</DialogTitle>
            <DialogDescription>Create a draft sales order for a customer.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Select value={oCustomerId} onValueChange={setOCustomerId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (<SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Quote (optional)</Label>
                <Select value={oQuoteId} onValueChange={setOQuoteId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {quotesRef.map((q) => (<SelectItem key={q.id} value={q.id}>{q.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Project (optional)</Label>
                <Select value={oProjectId} onValueChange={setOProjectId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-notes">Notes</Label>
              <Textarea id="o-notes" value={oNotes} onChange={(e) => setONotes(e.target.value)} rows={2} placeholder="Optional notes…" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOrderOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-order"
              onClick={handleCreateOrder}
              disabled={savingOrder || !oCustomerId}
            >
              {savingOrder && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Sales Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =============== CREATE INVOICE DIALOG =============== */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>New Invoice</DialogTitle>
            <DialogDescription>Create a draft invoice. A due date is required.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Select value={iCustomerId} onValueChange={setICustomerId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (<SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Sales Order (optional)</Label>
                <Select value={iSalesOrderId} onValueChange={setISalesOrderId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {ordersRef.map((o) => (<SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Project (optional)</Label>
                <Select value={iProjectId} onValueChange={setIProjectId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-due">Due Date *</Label>
              <Input id="i-due" type="date" value={iDueDate} onChange={(e) => setIDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-notes">Notes</Label>
              <Textarea id="i-notes" value={iNotes} onChange={(e) => setINotes(e.target.value)} rows={2} placeholder="Optional notes…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-terms">Terms</Label>
              <Textarea id="i-terms" value={iTerms} onChange={(e) => setITerms(e.target.value)} rows={2} placeholder="Payment terms, late fee policy, etc." />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInvoiceOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-invoice"
              onClick={handleCreateInvoice}
              disabled={savingInvoice || !iCustomerId || !iDueDate}
            >
              {savingInvoice && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =============== CREATE PAYMENT DIALOG =============== */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Record Customer Payment</DialogTitle>
            <DialogDescription>Create a draft payment. Posting applies it to finance and the invoice balance.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Select value={pCustomerId} onValueChange={setPCustomerId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (<SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Invoice (optional)</Label>
                <Select value={pInvoiceId} onValueChange={setPInvoiceId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {invoicesRef.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.label} (bal {money(i.balance)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
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
            <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-payment"
              onClick={handleCreatePayment}
              disabled={savingPayment || !pCustomerId || !pAmount || Number(pAmount) <= 0}
            >
              {savingPayment && <Loader2 className="h-4 w-4 animate-spin" />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
