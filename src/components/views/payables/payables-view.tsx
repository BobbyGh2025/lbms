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
  FileText, Wallet, Receipt, Plus, Loader2, ChevronRight,
  AlertCircle, Clock, RefreshCw, Building2,
} from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/finance/money";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SupplierOption { id: string; label: string; }
interface ProjectOption { id: string; label: string; }
interface FinancialAccountOption { id: string; label: string; }
interface LedgerAccountOption { code: string; label: string; }
interface EmployeeOption { id: string; label: string; }
interface BillOption { id: string; label: string; balance: string; }

interface SupplierLite {
  id: string; supplierNumber: string;
  tradingName: string | null; legalName: string | null;
}

interface BillListItem {
  id: string;
  billNumber: string;
  supplierId: string;
  supplier: SupplierLite | null;
  supplierRef: string | null;
  projectId: string | null;
  project?: { id: string; projectNumber: string; name: string } | null;
  billDate: string;
  dueDate: string | null;
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
  supplierId: string;
  supplier: SupplierLite | null;
  supplierBillId: string | null;
  supplierBill?: { id: string; billNumber: string; status: string } | null;
  financialAccountId: string;
  financialAccount?: { id: string; code: string; name: string; currency: string } | null;
  amount: string;
  paymentMethod: string;
  reference: string | null;
  status: string;
  paymentDate: string;
}

interface ExpenseListItem {
  id: string;
  expenseNumber: string;
  ledgerAccountCode: string;
  supplierId: string | null;
  supplier: SupplierLite | null;
  employeeId: string | null;
  employee?: { id: string; employeeNumber: string; firstName: string; lastName: string } | null;
  projectId: string | null;
  project?: { id: string; projectNumber: string; name: string; status: string } | null;
  financialAccountId: string;
  financialAccount?: { id: string; code: string; name: string; currency: string } | null;
  expenseDate: string;
  amount: string;
  description: string;
  paymentMethod: string;
  reference: string | null;
  status: string;
}

interface AgingBucket {
  count: number;
  amount: string;
}

interface PayablesSummary {
  totalPayable: string;
  totalOverdue: string;
  outstandingCount: number;
  overdueCount: number;
  billCount?: number;
}

interface SupplierBreakdownRow {
  supplierId: string;
  supplierNumber: string;
  name: string;
  status?: string | null;
  outstanding: string;
  overdue: string;
  billCount: number;
  overdueCount: number;
  oldestDueDate: string | null;
}

interface PayablesData {
  summary: PayablesSummary;
  aging: {
    "0-30": AgingBucket;
    "31-60": AgingBucket;
    "61-90": AgingBucket;
    "90+": AgingBucket;
  };
  supplierBreakdown: SupplierBreakdownRow[];
  generatedAt: string;
}

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

const EXPENSE_STATUS_BADGE: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  submitted: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  approved: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  posted: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  voided: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const AGING_ACCENTS: Record<string, string> = {
  "0-30": "bg-amber-500",
  "31-60": "bg-orange-500",
  "61-90": "bg-rose-500",
  "90+": "bg-rose-700",
};

const AGING_BADGES: Record<string, string> = {
  "0-30": "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "31-60": "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  "61-90": "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  "90+": "bg-rose-700/10 text-rose-700 dark:text-rose-300",
};

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function supplierLabel(s: SupplierLite | null): string {
  if (!s) return "—";
  return s.tradingName || s.legalName || s.supplierNumber;
}

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PayablesView() {
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("bills");

  // Permission gate (parallel to receivables-view)
  const canViewPayables = can("payables", "view");
  const canViewExpenses = can("expenses", "view");
  const canViewAny = canViewPayables || canViewExpenses;

  // =============== Bills ===============
  const [bills, setBills] = useState<BillListItem[]>([]);
  const [loadingBills, setLoadingBills] = useState(true);
  const [searchBills, setSearchBills] = useState("");
  const [statusBills, setStatusBills] = useState("all");

  // =============== Payments ===============
  const [payments, setPayments] = useState<PaymentListItem[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [searchPayments, setSearchPayments] = useState("");
  const [statusPayments, setStatusPayments] = useState("all");

  // =============== Expenses ===============
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [searchExpenses, setSearchExpenses] = useState("");
  const [statusExpenses, setStatusExpenses] = useState("all");

  // =============== AP Dashboard ===============
  const [apData, setApData] = useState<PayablesData | null>(null);
  const [loadingAp, setLoadingAp] = useState(true);
  const [refreshingAp, setRefreshingAp] = useState(false);

  // Reference data (lazy-loaded on dialog open)
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [finAccounts, setFinAccounts] = useState<FinancialAccountOption[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccountOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [billsRef, setBillsRef] = useState<BillOption[]>([]);
  const [refLoaded, setRefLoaded] = useState(false);

  // Dialog state
  const [billOpen, setBillOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [savingBill, setSavingBill] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);

  // Bill form
  const [bSupplierId, setBSupplierId] = useState("");
  const [bSupplierRef, setBSupplierRef] = useState("");
  const [bProjectId, setBProjectId] = useState("");
  const [bDueDate, setBDueDate] = useState("");
  const [bNotes, setBNotes] = useState("");

  // Payment form
  const [pSupplierId, setPSupplierId] = useState("");
  const [pBillId, setPBillId] = useState("");
  const [pFinAccountId, setPFinAccountId] = useState("");
  const [pAmount, setPAmount] = useState("");
  const [pMethod, setPMethod] = useState("bank_transfer");
  const [pReference, setPReference] = useState("");
  const [pNotes, setPNotes] = useState("");

  // Expense form
  const [eLedgerCode, setELedgerCode] = useState("");
  const [eSupplierId, setESupplierId] = useState("");
  const [eEmployeeId, setEEmployeeId] = useState("");
  const [eProjectId, setEProjectId] = useState("");
  const [eFinAccountId, setEFinAccountId] = useState("");
  const [eAmount, setEAmount] = useState("");
  const [eDescription, setEDescription] = useState("");
  const [eMethod, setEMethod] = useState("cash");
  const [eReference, setEReference] = useState("");
  const [eNotes, setENotes] = useState("");

  // ----- Fetchers -----
  const fetchBills = useCallback(async () => {
    if (!canViewPayables) { setLoadingBills(false); return; }
    try {
      setLoadingBills(true);
      const params = new URLSearchParams({ pageSize: "50" });
      if (searchBills) params.set("search", searchBills);
      if (statusBills !== "all") params.set("status", statusBills);
      const res = await fetch(`/api/payables/bills?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setBills(data.items ?? []);
    } catch {
      toast.error("Failed to load supplier bills.");
    } finally {
      setLoadingBills(false);
    }
  }, [searchBills, statusBills, canViewPayables]);

  const fetchPayments = useCallback(async () => {
    if (!canViewPayables) { setLoadingPayments(false); return; }
    try {
      setLoadingPayments(true);
      const params = new URLSearchParams({ pageSize: "50" });
      if (searchPayments) params.set("search", searchPayments);
      if (statusPayments !== "all") params.set("status", statusPayments);
      const res = await fetch(`/api/payables/payments?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setPayments(data.items ?? []);
    } catch {
      toast.error("Failed to load supplier payments.");
    } finally {
      setLoadingPayments(false);
    }
  }, [searchPayments, statusPayments, canViewPayables]);

  const fetchExpenses = useCallback(async () => {
    if (!canViewExpenses) { setLoadingExpenses(false); return; }
    try {
      setLoadingExpenses(true);
      const params = new URLSearchParams({ pageSize: "50" });
      if (searchExpenses) params.set("search", searchExpenses);
      if (statusExpenses !== "all") params.set("status", statusExpenses);
      const res = await fetch(`/api/expenses?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setExpenses(data.items ?? []);
    } catch {
      toast.error("Failed to load expenses.");
    } finally {
      setLoadingExpenses(false);
    }
  }, [searchExpenses, statusExpenses, canViewExpenses]);

  const fetchAp = useCallback(async (silent = false) => {
    if (!canViewPayables) { setLoadingAp(false); return; }
    if (!silent) setLoadingAp(true);
    else setRefreshingAp(true);
    try {
      const res = await fetch(`/api/payables/receivables`);
      if (!res.ok) {
        if (!silent) toast.error("Failed to load AP dashboard.");
        return;
      }
      setData(await res.json());
    } catch {
      if (!silent) toast.error("Failed to load AP dashboard.");
    } finally {
      setLoadingAp(false);
      setRefreshingAp(false);
    }
  }, [canViewPayables]);

  // Local setData helper (avoids stale-name shadowing with setApData).
  function setData(d: PayablesData) { setApData(d); }

  useEffect(() => { fetchBills(); }, [fetchBills]);
  useEffect(() => { fetchPayments(); }, [fetchPayments]);
  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);
  useEffect(() => { fetchAp(); }, [fetchAp]);

  // Load reference data on first dialog open
  useEffect(() => {
    if (!billOpen && !paymentOpen && !expenseOpen) return;
    if (refLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const [sRes, pRes, fRes, lRes, eRes] = await Promise.all([
          fetch("/api/suppliers?pageSize=100").catch(() => null),
          fetch("/api/projects?pageSize=100").catch(() => null),
          fetch("/api/finance/accounts").catch(() => null),
          fetch("/api/finance/categories?accountClass=expense").catch(() => null),
          fetch("/api/staff?pageSize=100").catch(() => null),
        ]);
        if (cancelled) return;
        const s = sRes && sRes.ok ? await sRes.json() : { items: [] };
        const p = pRes && pRes.ok ? await pRes.json() : { items: [] };
        const f = fRes && fRes.ok ? await fRes.json() : { items: [] };
        const l = lRes && lRes.ok ? await lRes.json() : { items: [] };
        const e = eRes && eRes.ok ? await eRes.json() : { items: [] };
        setSuppliers((s.items ?? []).map((x: any) => ({
          id: x.id,
          label: x.tradingName || x.legalName || x.supplierNumber || x.id,
        })));
        setProjects((p.items ?? []).map((x: any) => ({
          id: x.id,
          label: `${x.projectNumber} — ${x.name}`,
        })));
        setFinAccounts((f.items ?? []).map((x: any) => ({
          id: x.id,
          label: `${x.code} — ${x.name}`,
        })));
        setLedgerAccounts((l.items ?? []).map((x: any) => ({
          code: x.code,
          label: `${x.code} — ${x.name}`,
        })));
        setEmployees((e.items ?? []).map((x: any) => ({
          id: x.id,
          label: `${x.employeeNumber} — ${[x.firstName, x.lastName].filter(Boolean).join(" ")}`,
        })));
        setRefLoaded(true);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [billOpen, paymentOpen, expenseOpen, refLoaded]);

  // When payment dialog opens, fetch posted/partially_paid bills for selection
  useEffect(() => {
    if (!paymentOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/payables/bills?pageSize=100&status=posted`);
        if (cancelled) return;
        if (!res.ok) return;
        const data = await res.json();
        // Also pull partially_paid
        const res2 = await fetch(`/api/payables/bills?pageSize=100&status=partially_paid`);
        if (cancelled) return;
        const extra = res2.ok ? await res2.json() : { items: [] };
        const combined = [...(data.items ?? []), ...(extra.items ?? [])];
        setBillsRef(combined.map((x: any) => ({
          id: x.id,
          label: x.billNumber,
          balance: x.balanceDue,
        })));
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [paymentOpen]);

  // ----- Navigation -----
  function go(view: string, id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    params.set("id", id);
    router.push(`?${params.toString()}`);
  }

  // ----- Submit handlers -----
  async function handleCreateBill() {
    if (!bSupplierId) { toast.error("Supplier is required."); return; }
    setSavingBill(true);
    try {
      const res = await fetch("/api/payables/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: bSupplierId,
          supplierRef: bSupplierRef.trim() || undefined,
          projectId: bProjectId || undefined,
          dueDate: bDueDate || undefined,
          notes: bNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create bill.");
      }
      const created = await res.json();
      toast.success(`Bill created: ${created.billNumber}`);
      setBillOpen(false);
      setBSupplierId(""); setBSupplierRef(""); setBProjectId("");
      setBDueDate(""); setBNotes("");
      fetchBills();
      fetchAp(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create bill.");
    } finally {
      setSavingBill(false);
    }
  }

  async function handleCreatePayment() {
    if (!pSupplierId) { toast.error("Supplier is required."); return; }
    if (!pFinAccountId) { toast.error("Paying financial account is required."); return; }
    if (!pAmount || Number(pAmount) <= 0) {
      toast.error("Amount must be greater than zero."); return;
    }
    setSavingPayment(true);
    try {
      const res = await fetch("/api/payables/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: pSupplierId,
          supplierBillId: pBillId || undefined,
          financialAccountId: pFinAccountId,
          amount: pAmount,
          paymentMethod: pMethod,
          reference: pReference.trim() || undefined,
          notes: pNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to record payment.");
      }
      const created = await res.json();
      toast.success(`Payment recorded: ${created.paymentNumber} (draft)`);
      setPaymentOpen(false);
      setPSupplierId(""); setPBillId(""); setPFinAccountId(""); setPAmount("");
      setPMethod("bank_transfer"); setPReference(""); setPNotes("");
      fetchPayments();
      fetchAp(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record payment.");
    } finally {
      setSavingPayment(false);
    }
  }

  async function handleCreateExpense() {
    if (!eFinAccountId) { toast.error("Paying financial account is required."); return; }
    if (!eAmount || Number(eAmount) <= 0) {
      toast.error("Amount must be greater than zero."); return;
    }
    if (!eDescription.trim()) { toast.error("Description is required."); return; }
    setSavingExpense(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ledgerAccountCode: eLedgerCode || undefined,
          supplierId: eSupplierId || undefined,
          employeeId: eEmployeeId || undefined,
          projectId: eProjectId || undefined,
          financialAccountId: eFinAccountId,
          amount: eAmount,
          description: eDescription.trim(),
          paymentMethod: eMethod,
          reference: eReference.trim() || undefined,
          notes: eNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create expense.");
      }
      const created = await res.json();
      toast.success(`Expense created: ${created.expenseNumber}`);
      setExpenseOpen(false);
      setELedgerCode(""); setESupplierId(""); setEEmployeeId(""); setEProjectId("");
      setEFinAccountId(""); setEAmount(""); setEDescription("");
      setEMethod("cash"); setEReference(""); setENotes("");
      fetchExpenses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create expense.");
    } finally {
      setSavingExpense(false);
    }
  }

  // ----- No-permission guard -----
  if (!canViewAny) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Payables & Expenses"
          description="Supplier bills, payments, expenses and AP dashboard"
        />
        <EmptyState
          icon={Wallet}
          title="No access"
          description="You do not have permission to view payables or expenses."
        />
      </div>
    );
  }

  // ----- AP dashboard aging bars -----
  const agingBars = apData ? [
    { label: "0–30 days", bucket: apData.aging["0-30"], accent: AGING_ACCENTS["0-30"], badge: AGING_BADGES["0-30"] },
    { label: "31–60 days", bucket: apData.aging["31-60"], accent: AGING_ACCENTS["31-60"], badge: AGING_BADGES["31-60"] },
    { label: "61–90 days", bucket: apData.aging["61-90"], accent: AGING_ACCENTS["61-90"], badge: AGING_BADGES["61-90"] },
    { label: "90+ days", bucket: apData.aging["90+"], accent: AGING_ACCENTS["90+"], badge: AGING_BADGES["90+"] },
  ] : [];
  const totalAgingAmount = agingBars.reduce(
    (acc, b) => acc + Number(b.bucket.amount || 0), 0,
  );

  // ----- Render -----
  return (
    <div className="space-y-5">
      <PageHeader
        title="Payables & Expenses"
        description="Supplier bills, payments, expenses and AP dashboard"
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="bills">Supplier Bills</TabsTrigger>
          <TabsTrigger value="payments">Supplier Payments</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="dashboard">AP Dashboard</TabsTrigger>
        </TabsList>

        {/* =============== BILLS TAB =============== */}
        <TabsContent value="bills" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="Search by bill #…"
                value={searchBills}
                onChange={(e) => setSearchBills(e.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={statusBills} onValueChange={setStatusBills}>
                <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="posted">Posted</SelectItem>
                  <SelectItem value="partially_paid">Partially Paid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="voided">Voided</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {can("payables", "create") && (
              <Button onClick={() => setBillOpen(true)}>
                <Plus className="h-4 w-4" /> New Bill
              </Button>
            )}
          </div>

          {loadingBills ? (
            <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : bills.length === 0 ? (
            <EmptyState icon={FileText} title="No supplier bills" description="Create your first supplier bill to get started." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bill #</TableHead>
                        <TableHead>Supplier</TableHead>
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
                      {bills.map((b) => (
                        <TableRow
                          key={b.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => go("supplier-bill-profile", b.id)}
                        >
                          <TableCell className="font-mono text-xs">{b.billNumber}</TableCell>
                          <TableCell className="text-sm font-medium">{supplierLabel(b.supplier)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={BILL_STATUS_BADGE[b.status] ?? ""}>
                              {b.status.replace("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {b.overdue ? (
                              <Badge variant="outline" className="bg-rose-500/10 text-rose-700 dark:text-rose-300">
                                <AlertCircle className="h-3 w-3 mr-1" /> OVERDUE
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs">{money(b.total)}</TableCell>
                          <TableCell className="text-right text-xs">{money(b.amountPaid)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{money(b.balanceDue)}</TableCell>
                          <TableCell className="text-xs">
                            <span className={b.overdue ? "text-rose-600 font-medium" : ""}>
                              {fmt(b.dueDate)}
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
            {can("payables", "pay") && (
              <Button onClick={() => setPaymentOpen(true)}>
                <Plus className="h-4 w-4" /> New Payment
              </Button>
            )}
          </div>

          {loadingPayments ? (
            <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : payments.length === 0 ? (
            <EmptyState icon={Wallet} title="No supplier payments" description="Record your first supplier payment to get started." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Payment #</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Bill</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">{p.paymentNumber}</TableCell>
                          <TableCell className="text-sm font-medium">{supplierLabel(p.supplier)}</TableCell>
                          <TableCell className="font-mono text-xs">{p.supplierBill?.billNumber || "—"}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{money(p.amount)}</TableCell>
                          <TableCell className="text-xs capitalize">{p.paymentMethod.replace("_", " ")}</TableCell>
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

        {/* =============== EXPENSES TAB =============== */}
        <TabsContent value="expenses" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="Search by expense #…"
                value={searchExpenses}
                onChange={(e) => setSearchExpenses(e.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={statusExpenses} onValueChange={setStatusExpenses}>
                <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="posted">Posted</SelectItem>
                  <SelectItem value="voided">Voided</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {can("expenses", "create") && (
              <Button onClick={() => setExpenseOpen(true)}>
                <Plus className="h-4 w-4" /> New Expense
              </Button>
            )}
          </div>

          {loadingExpenses ? (
            <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : expenses.length === 0 ? (
            <EmptyState icon={Receipt} title="No expenses" description="Create your first expense to get started." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Expense #</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenses.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="font-mono text-xs">{e.expenseNumber}</TableCell>
                          <TableCell className="font-mono text-xs">{e.ledgerAccountCode || "—"}</TableCell>
                          <TableCell className="text-sm font-medium max-w-xs truncate">{e.description}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{money(e.amount)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={EXPENSE_STATUS_BADGE[e.status] ?? ""}>
                              {e.status.replace("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{fmt(e.expenseDate)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* =============== AP DASHBOARD TAB =============== */}
        <TabsContent value="dashboard" className="mt-4 space-y-4">
          {!canViewPayables ? (
            <EmptyState
              icon={Wallet}
              title="No access"
              description="You do not have permission to view the AP dashboard."
            />
          ) : (
            <>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchAp(true)}
                  disabled={refreshingAp}
                >
                  {refreshingAp ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Refresh
                </Button>
              </div>

              {/* KPI cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Total Payable</p>
                      {loadingAp ? (
                        <Skeleton className="mt-2 h-7 w-32" />
                      ) : (
                        <p className="mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">
                          {money(apData?.summary.totalPayable)}
                        </p>
                      )}
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        Across {apData?.summary.outstandingCount ?? 0} open bill(s)
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <Wallet className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Overdue Payable</p>
                      {loadingAp ? (
                        <Skeleton className="mt-2 h-7 w-32" />
                      ) : (
                        <p className="mt-1 truncate text-xl font-bold tracking-tight text-rose-600 sm:text-2xl">
                          {money(apData?.summary.totalOverdue)}
                        </p>
                      )}
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {apData?.summary.overdueCount ?? 0} overdue bill(s)
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
                      <AlertCircle className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Outstanding Bills</p>
                      {loadingAp ? (
                        <Skeleton className="mt-2 h-7 w-24" />
                      ) : (
                        <p className="mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">
                          {apData?.summary.outstandingCount ?? 0}
                        </p>
                      )}
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        With unpaid balance
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <FileText className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Overdue Bills</p>
                      {loadingAp ? (
                        <Skeleton className="mt-2 h-7 w-24" />
                      ) : (
                        <p className="mt-1 truncate text-xl font-bold tracking-tight text-rose-600 sm:text-2xl">
                          {apData?.summary.overdueCount ?? 0}
                        </p>
                      )}
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        Past due date
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
                      <Clock className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Aging buckets */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="h-4 w-4" /> Aging Buckets
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {loadingAp ? (
                    <div className="space-y-2">
                      {[1,2,3,4].map(i => <Skeleton key={i} className="h-8 w-full" />)}
                    </div>
                  ) : totalAgingAmount === 0 ? (
                    <EmptyState
                      icon={Wallet}
                      title="No overdue balances"
                      description="All supplier bills are within their due dates."
                    />
                  ) : (
                    <div className="space-y-3">
                      {agingBars.map((b) => {
                        const amount = Number(b.bucket.amount || 0);
                        const pct = totalAgingAmount > 0 ? Math.round((amount / totalAgingAmount) * 100) : 0;
                        return (
                          <div key={b.label} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className={b.badge}>
                                  {b.label}
                                </Badge>
                                <span className="text-muted-foreground">{b.bucket.count} bill(s)</span>
                              </div>
                              <span className="font-semibold">{money(b.bucket.amount)} · {pct}%</span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-full rounded-full ${b.accent}`}
                                style={{ width: `${Math.max(2, pct)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {apData && (
                    <p className="text-xs text-muted-foreground pt-2 border-t">
                      Snapshot generated {fmtDateTime(apData.generatedAt)}.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Supplier breakdown */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Building2 className="h-4 w-4" /> Supplier Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {loadingAp ? (
                    <div className="p-4 space-y-2">
                      {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                    </div>
                  ) : !apData || apData.supplierBreakdown.length === 0 ? (
                    <div className="p-6">
                      <EmptyState
                        icon={Wallet}
                        title="No outstanding supplier balances"
                        description="All supplier bills are fully paid."
                      />
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Supplier</TableHead>
                            <TableHead className="text-right">Outstanding</TableHead>
                            <TableHead className="text-right">Overdue</TableHead>
                            <TableHead className="text-right">Bills</TableHead>
                            <TableHead>Oldest Due</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {apData.supplierBreakdown.map((s) => {
                            const overdueNum = Number(s.overdue || 0);
                            return (
                              <TableRow key={s.supplierId}>
                                <TableCell>
                                  <div className="text-sm font-medium">{s.name}</div>
                                  <div className="text-xs text-muted-foreground font-mono">{s.supplierNumber}</div>
                                </TableCell>
                                <TableCell className="text-right text-sm font-semibold">
                                  {money(s.outstanding)}
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  {overdueNum > 0 ? (
                                    <span className="text-rose-600 font-medium">{money(s.overdue)}</span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right text-xs">
                                  <span>{s.billCount}</span>
                                  {s.overdueCount > 0 && (
                                    <span className="text-rose-600 ml-1">({s.overdueCount} overdue)</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {s.oldestDueDate ? (
                                    <span className={overdueNum > 0 ? "text-rose-600 font-medium" : ""}>
                                      {fmt(s.oldestDueDate)}
                                    </span>
                                  ) : "—"}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* =============== CREATE BILL DIALOG =============== */}
      <Dialog open={billOpen} onOpenChange={setBillOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>New Supplier Bill</DialogTitle>
            <DialogDescription>Create a draft bill from a supplier. Items can be added after creation.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <Select value={bSupplierId} onValueChange={setBSupplierId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Project (optional)</Label>
                <Select value={bProjectId} onValueChange={setBProjectId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-due">Due Date</Label>
                <Input id="b-due" type="date" value={bDueDate} onChange={(e) => setBDueDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-ref">Supplier Reference</Label>
              <Input id="b-ref" value={bSupplierRef} onChange={(e) => setBSupplierRef(e.target.value)} placeholder="Supplier's own invoice #…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-notes">Notes</Label>
              <Textarea id="b-notes" value={bNotes} onChange={(e) => setBNotes(e.target.value)} rows={2} placeholder="Optional internal notes…" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBillOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-bill"
              onClick={handleCreateBill}
              disabled={savingBill || !bSupplierId}
            >
              {savingBill && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =============== CREATE PAYMENT DIALOG =============== */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>New Supplier Payment</DialogTitle>
            <DialogDescription>
              Record a payment to a supplier. Posting applies it to AP and the linked bill's balance.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Supplier</Label>
                <Select value={pSupplierId} onValueChange={setPSupplierId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Bill (optional)</Label>
                <Select value={pBillId} onValueChange={setPBillId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {billsRef.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.label} (bal {money(b.balance)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Paying Account</Label>
              <Select value={pFinAccountId} onValueChange={setPFinAccountId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {finAccounts.map((f) => (<SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>))}
                </SelectContent>
              </Select>
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
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-ref">Reference</Label>
              <Input id="p-ref" value={pReference} onChange={(e) => setPReference(e.target.value)} placeholder="Cheque #, Bank slip…" />
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
              disabled={savingPayment || !pSupplierId || !pFinAccountId || !pAmount || Number(pAmount) <= 0}
            >
              {savingPayment && <Loader2 className="h-4 w-4 animate-spin" />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =============== CREATE EXPENSE DIALOG =============== */}
      <Dialog open={expenseOpen} onOpenChange={setExpenseOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>New Expense</DialogTitle>
            <DialogDescription>
              Record a direct business expense. Posting pays immediately (Dr Expense / Cr Cash) — no AP entry.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Expense Category</Label>
              <Select value={eLedgerCode} onValueChange={setELedgerCode}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {ledgerAccounts.map((l) => (<SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-desc">Description *</Label>
              <Input id="e-desc" value={eDescription} onChange={(e) => setEDescription(e.target.value)} placeholder="e.g. Office stationery purchase" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="e-amount">Amount *</Label>
                <Input id="e-amount" inputMode="decimal" value={eAmount} onChange={(e) => setEAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Paying Account</Label>
                <Select value={eFinAccountId} onValueChange={setEFinAccountId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {finAccounts.map((f) => (<SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Supplier (optional)</Label>
                <Select value={eSupplierId} onValueChange={setESupplierId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Employee (optional)</Label>
                <Select value={eEmployeeId} onValueChange={setEEmployeeId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((em) => (<SelectItem key={em.id} value={em.id}>{em.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Project (optional)</Label>
                <Select value={eProjectId} onValueChange={setEProjectId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Payment Method</Label>
                <Select value={eMethod} onValueChange={setEMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-ref">Reference</Label>
              <Input id="e-ref" value={eReference} onChange={(e) => setEReference(e.target.value)} placeholder="Receipt #…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-notes">Notes</Label>
              <Textarea id="e-notes" value={eNotes} onChange={(e) => setENotes(e.target.value)} rows={2} placeholder="Optional notes…" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setExpenseOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-expense"
              onClick={handleCreateExpense}
              disabled={savingExpense || !eFinAccountId || !eAmount || Number(eAmount) <= 0 || !eDescription.trim()}
            >
              {savingExpense && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
