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
  Plus, Loader2, ChevronRight, RefreshCw, Wallet, TrendingUp,
  TrendingDown, FileText, PiggyBank, AlertCircle, Calendar,
  Banknote, ArrowDownCircle, ArrowUpCircle, Calculator, Lock,
  CheckCircle2, XCircle, Send, Layers, Target,
} from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/finance/money";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BudgetListItem {
  id: string;
  budgetNumber: string;
  name: string;
  description: string | null;
  fiscalYear: number;
  startDate: string;
  endDate: string;
  status: string;
  version: number;
  currency: string;
  totalAmount: string;
  lineCount?: number;
  _count?: { lines: number };
}

interface BudgetLineDept {
  id: string;
  name: string;
  code: string | null;
}

interface BudgetLineProject {
  id: string;
  projectNumber: string;
  name: string;
}

interface BudgetLine {
  id: string;
  budgetId: string;
  ledgerAccountCode: string;
  accountClass: string;
  departmentId: string | null;
  projectId: string | null;
  month: number;
  amount: string;
  notes: string | null;
  department: BudgetLineDept | null;
  project: BudgetLineProject | null;
}

interface BudgetDetail {
  id: string;
  budgetNumber: string;
  name: string;
  description: string | null;
  fiscalYear: number;
  startDate: string;
  endDate: string;
  status: string;
  version: number;
  currency: string;
  totalAmount: string;
  submittedAt: string | null;
  approvedAt: string | null;
  lockedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  submittedBy: { id: string; username: string } | null;
  approvedBy: { id: string; username: string } | null;
  lockedBy: { id: string; username: string } | null;
  createdBy: { id: string; username: string } | null;
  updatedBy: { id: string; username: string } | null;
  lines: BudgetLine[];
  totalIncome: string;
  totalExpense: string;
  lineCount: number;
}

interface LedgerAccountOption {
  code: string;
  label: string;
  accountClass: string;
  name: string;
}

interface DepartmentOption { id: string; name: string; code: string | null; }
interface ProjectOption { id: string; projectNumber: string; name: string; }

interface VarianceBudget {
  id: string;
  budgetNumber: string;
  name: string;
  fiscalYear: number;
  startDate: string;
  endDate: string;
  status: string;
  currency: string;
  totalAmount: string;
}

interface VarianceLine {
  id: string;
  ledgerAccountCode: string;
  accountName: string;
  accountClass: string;
  month: number;
  budgetAmount: string;
  actualAmount: string;
  variance: string;
  variancePct: string;
  classification: "favorable" | "unfavorable" | "neutral";
  department: BudgetLineDept | null;
  project: BudgetLineProject | null;
  notes: string | null;
}

interface VarianceTotals {
  totalBudget: string;
  totalActual: string;
  totalVariance: string;
  incomeBudget: string;
  incomeActual: string;
  expenseBudget: string;
  expenseActual: string;
  favorableCount: number;
  unfavorableCount: number;
  neutralCount: number;
}

interface VarianceData {
  budget: VarianceBudget;
  period: { from: string; to: string };
  groupBy: string;
  byLine: VarianceLine[];
  totals: VarianceTotals;
}

interface ArInvoiceDetail {
  id: string;
  invoiceNumber: string;
  customer: { id: string; name: string } | null;
  dueDate: string;
  total: string;
  balanceDue: string;
  status: string;
}

interface ApBillDetail {
  id: string;
  billNumber: string;
  supplier: { id: string; name: string } | null;
  dueDate: string | null;
  total: string;
  balanceDue: string;
  status: string;
}

interface PlannedLine {
  id: string;
  ledgerAccountCode: string;
  month: number;
  amount: string;
  budget: {
    id: string;
    budgetNumber: string;
    name: string;
    status: string;
    fiscalYear: number;
  };
  department: BudgetLineDept | null;
  project: BudgetLineProject | null;
}

interface CashForecastData {
  generatedAt: string;
  horizonDays: number;
  period: { from: string; to: string };
  openingCash: string;
  expectedAR: {
    total: string;
    count: number;
    invoices: ArInvoiceDetail[];
  };
  expectedAP: {
    total: string;
    count: number;
    bills: ApBillDetail[];
  };
  plannedExpenses: {
    total: string;
    lineCount: number;
    months: number[];
    lines: PlannedLine[];
  };
  projectedClosingCash: string;
  summary: {
    inflows: string;
    outflows: string;
    netCashFlow: string;
  };
}

interface ForecastSummaryData {
  generatedAt: string;
  fiscalYear: number;
  horizonDays: number;
  budgetTotals: {
    incomeBudget: string;
    expenseBudget: string;
    totalBudget: string;
    activeBudgetCount: number;
    activeLineCount: number;
  };
  actuals: {
    incomeActual: string;
    expenseActual: string;
    netActual: string;
    cashPosition: string;
    transactionCount: number;
  };
  varianceSummary: {
    income: {
      variance: string;
      variancePct: string;
      classification: string;
    };
    expense: {
      variance: string;
      variancePct: string;
      classification: string;
    };
    netBudget: string;
    netActual: string;
    netVariance: string;
  };
  arForecast: { total: string; count: number };
  apForecast: { total: string; count: number };
  cashForecast: {
    openingCash: string;
    expectedAR: string;
    expectedAP: string;
    plannedExpenses: string;
    projectedClosingCash: string;
    months: number[];
  };
  statusBreakdown: { status: string; count: number; total: string }[];
}

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const BUDGET_STATUS_BADGE: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  submitted: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  approved: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  locked: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const VARIANCE_CLASSIFICATION_BADGE: Record<string, string> = {
  favorable: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  unfavorable: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  neutral: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
};

const MONTHS = [
  { value: "1", label: "Jan" }, { value: "2", label: "Feb" },
  { value: "3", label: "Mar" }, { value: "4", label: "Apr" },
  { value: "5", label: "May" }, { value: "6", label: "Jun" },
  { value: "7", label: "Jul" }, { value: "8", label: "Aug" },
  { value: "9", label: "Sep" }, { value: "10", label: "Oct" },
  { value: "11", label: "Nov" }, { value: "12", label: "Dec" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "locked", label: "Locked" },
  { value: "cancelled", label: "Cancelled" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  if (v === null || v === undefined || v === "") return "GHS 0.00";
  return formatMoney(v, "GHS");
}

function pct(v: string | null | undefined): string {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return "0.0%";
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function signedMoney(v: string | null | undefined): string {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return "GHS 0.00";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${money(Math.abs(n).toString()).replace("GHS ", "GHS ")}`;
}

function monthLabel(m: number): string {
  return MONTHS.find((x) => Number(x.value) === m)?.label ?? String(m);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BudgetsView() {
  const { can } = useAuth();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("budgets");

  // Permission gate
  const canViewBudgets = can("budgets", "view");

  // =============== Budgets tab ===============
  const [budgets, setBudgets] = useState<BudgetListItem[]>([]);
  const [loadingBudgets, setLoadingBudgets] = useState(true);
  const [searchBudgets, setSearchBudgets] = useState("");
  const [statusBudgets, setStatusBudgets] = useState("all");
  const [fyBudgets, setFyBudgets] = useState("all");

  // =============== Budget detail dialog ===============
  const [detailBudget, setDetailBudget] = useState<BudgetDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // =============== New budget dialog ===============
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [savingBudget, setSavingBudget] = useState(false);
  const [nName, setNName] = useState("");
  const [nDescription, setNDescription] = useState("");
  const [nFiscalYear, setNFiscalYear] = useState(String(new Date().getFullYear()));
  const [nStartDate, setNStartDate] = useState("");
  const [nEndDate, setNEndDate] = useState("");
  const [nCurrency, setNCurrency] = useState("GHS");

  // =============== Add line dialog ===============
  const [lineOpen, setLineOpen] = useState(false);
  const [savingLine, setSavingLine] = useState(false);
  const [lAccountCode, setLAccountCode] = useState("");
  const [lMonth, setLMonth] = useState("1");
  const [lAmount, setLAmount] = useState("");
  const [lDepartmentId, setLDepartmentId] = useState("");
  const [lProjectId, setLProjectId] = useState("");
  const [lNotes, setLNotes] = useState("");

  // =============== Reference data ===============
  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccountOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [refLoaded, setRefLoaded] = useState(false);

  // =============== Variance tab ===============
  const [varianceBudgets, setVarianceBudgets] = useState<VarianceBudget[]>([]);
  const [loadingVarianceList, setLoadingVarianceList] = useState(true);
  const [varianceBudgetId, setVarianceBudgetId] = useState("");
  const [varianceData, setVarianceData] = useState<VarianceData | null>(null);
  const [loadingVariance, setLoadingVariance] = useState(false);

  // =============== Cash forecast tab ===============
  const [cashForecast, setCashForecast] = useState<CashForecastData | null>(null);
  const [loadingCash, setLoadingCash] = useState(true);
  const [cashHorizon, setCashHorizon] = useState("30");

  // =============== Forecast summary tab ===============
  const [forecastSummary, setForecastSummary] = useState<ForecastSummaryData | null>(null);
  const [loadingForecast, setLoadingForecast] = useState(true);
  const [forecastHorizon, setForecastHorizon] = useState("30");
  const [forecastFy, setForecastFy] = useState(String(new Date().getFullYear()));

  // ----- Fetchers -----
  const fetchBudgets = useCallback(async () => {
    if (!canViewBudgets) { setLoadingBudgets(false); return; }
    try {
      setLoadingBudgets(true);
      const params = new URLSearchParams({ pageSize: "50" });
      if (searchBudgets) params.set("search", searchBudgets);
      if (statusBudgets !== "all") params.set("status", statusBudgets);
      if (fyBudgets !== "all") params.set("fiscalYear", fyBudgets);
      const res = await fetch(`/api/budgets?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setBudgets(data.items ?? []);
    } catch {
      toast.error("Failed to load budgets.");
    } finally {
      setLoadingBudgets(false);
    }
  }, [searchBudgets, statusBudgets, fyBudgets, canViewBudgets]);

  const fetchVarianceBudgets = useCallback(async () => {
    if (!canViewBudgets) { setLoadingVarianceList(false); return; }
    try {
      setLoadingVarianceList(true);
      const res = await fetch(`/api/budgets?pageSize=100&status=approved`);
      if (!res.ok) return;
      const data = await res.json();
      const approved = (data.items ?? []) as BudgetListItem[];
      // Also fetch locked budgets
      const res2 = await fetch(`/api/budgets?pageSize=100&status=locked`);
      const locked = res2.ok ? ((await res2.json()).items ?? []) as BudgetListItem[] : [];
      const combined = [...approved, ...locked].map((b) => ({
        id: b.id,
        budgetNumber: b.budgetNumber,
        name: b.name,
        fiscalYear: b.fiscalYear,
        startDate: b.startDate,
        endDate: b.endDate,
        status: b.status,
        currency: b.currency,
        totalAmount: b.totalAmount,
      }));
      setVarianceBudgets(combined);
      // Auto-select first if we don't have a selection
      if (combined.length > 0 && !varianceBudgetId) {
        setVarianceBudgetId(combined[0].id);
      }
    } catch {
      toast.error("Failed to load approved budgets for variance analysis.");
    } finally {
      setLoadingVarianceList(false);
    }
  }, [canViewBudgets, varianceBudgetId]);

  const fetchVariance = useCallback(async () => {
    if (!canViewBudgets || !varianceBudgetId) { setLoadingVariance(false); return; }
    try {
      setLoadingVariance(true);
      const res = await fetch(`/api/budgets/${varianceBudgetId}/variance?groupBy=line`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load variance analysis.");
      }
      const data = await res.json();
      setVarianceData(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load variance analysis.");
      setVarianceData(null);
    } finally {
      setLoadingVariance(false);
    }
  }, [canViewBudgets, varianceBudgetId]);

  const fetchCashForecast = useCallback(async () => {
    if (!canViewBudgets) { setLoadingCash(false); return; }
    try {
      setLoadingCash(true);
      const res = await fetch(`/api/budgets/cash-forecast?horizon=${encodeURIComponent(cashHorizon)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load cash forecast.");
      }
      const data = await res.json();
      setCashForecast(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load cash forecast.");
      setCashForecast(null);
    } finally {
      setLoadingCash(false);
    }
  }, [canViewBudgets, cashHorizon]);

  const fetchForecastSummary = useCallback(async () => {
    if (!canViewBudgets) { setLoadingForecast(false); return; }
    try {
      setLoadingForecast(true);
      const params = new URLSearchParams({
        horizon: forecastHorizon,
        fiscalYear: forecastFy,
      });
      const res = await fetch(`/api/budgets/forecast?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load forecast summary.");
      }
      const data = await res.json();
      setForecastSummary(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load forecast summary.");
      setForecastSummary(null);
    } finally {
      setLoadingForecast(false);
    }
  }, [canViewBudgets, forecastHorizon, forecastFy]);

  // ----- Effects -----
  useEffect(() => { fetchBudgets(); }, [fetchBudgets]);

  useEffect(() => {
    if (tab === "variance" && varianceBudgets.length === 0) {
      fetchVarianceBudgets();
    }
  }, [tab, varianceBudgets.length, fetchVarianceBudgets]);

  useEffect(() => {
    if (tab === "variance" && varianceBudgetId) {
      fetchVariance();
    }
  }, [tab, varianceBudgetId, fetchVariance]);

  useEffect(() => {
    if (tab === "cash") {
      fetchCashForecast();
    }
  }, [tab, fetchCashForecast]);

  useEffect(() => {
    if (tab === "forecast") {
      fetchForecastSummary();
    }
  }, [tab, fetchForecastSummary]);

  // Sync tab from URL on mount
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && ["budgets", "variance", "cash", "forecast"].includes(t)) {
      setTab(t);
    }
  }, [searchParams]);

  // Load reference data on first dialog open
  useEffect(() => {
    if (!budgetOpen && !lineOpen) return;
    if (refLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const [lRes, dRes, pRes] = await Promise.all([
          fetch("/api/finance/categories").catch(() => null),
          fetch("/api/departments?pageSize=100").catch(() => null),
          fetch("/api/projects?pageSize=100").catch(() => null),
        ]);
        if (cancelled) return;
        const l = lRes && lRes.ok ? await lRes.json() : { items: [] };
        const d = dRes && dRes.ok ? await dRes.json() : { items: [] };
        const p = pRes && pRes.ok ? await pRes.json() : { items: [] };
        setLedgerAccounts((l.items ?? [])
          .filter((x: any) => x.accountClass === "income" || x.accountClass === "expense")
          .filter((x: any) => x.status === "active")
          .map((x: any) => ({
            code: x.code,
            name: x.name,
            accountClass: x.accountClass,
            label: `${x.code} — ${x.name} (${x.accountClass})`,
          })));
        setDepartments((d.items ?? []).map((x: any) => ({
          id: x.id, name: x.name, code: x.code,
        })));
        setProjects((p.items ?? []).map((x: any) => ({
          id: x.id, projectNumber: x.projectNumber, name: x.name,
        })));
        setRefLoaded(true);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [budgetOpen, lineOpen, refLoaded]);

  // ----- Handlers -----
  async function handleCreateBudget() {
    if (!nName.trim()) { toast.error("Budget name is required."); return; }
    const fy = Number(nFiscalYear);
    if (!fy || fy < 2000 || fy > 2100) { toast.error("Valid fiscal year is required."); return; }
    if (!nStartDate) { toast.error("Start date is required."); return; }
    if (!nEndDate) { toast.error("End date is required."); return; }
    if (new Date(nEndDate) <= new Date(nStartDate)) {
      toast.error("End date must be after start date.");
      return;
    }
    setSavingBudget(true);
    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nName.trim(),
          description: nDescription.trim() || undefined,
          fiscalYear: fy,
          startDate: nStartDate,
          endDate: nEndDate,
          currency: nCurrency.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create budget.");
      }
      const created = await res.json();
      toast.success(`Budget created: ${created.budgetNumber}`);
      setBudgetOpen(false);
      setNName(""); setNDescription(""); setNStartDate(""); setNEndDate(""); setNCurrency("GHS");
      fetchBudgets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create budget.");
    } finally {
      setSavingBudget(false);
    }
  }

  async function loadBudgetDetail(id: string) {
    setDetailOpen(true);
    setLoadingDetail(true);
    setDetailBudget(null);
    try {
      const res = await fetch(`/api/budgets/${id}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load budget.");
      }
      const data = await res.json();
      setDetailBudget(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load budget.");
      setDetailOpen(false);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleAddLine() {
    if (!detailBudget) return;
    if (!lAccountCode) { toast.error("Ledger account is required."); return; }
    if (!lAmount || Number(lAmount) < 0) { toast.error("Valid amount is required."); return; }
    setSavingLine(true);
    try {
      const res = await fetch(`/api/budgets/${detailBudget.id}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ledgerAccountCode: lAccountCode,
          month: Number(lMonth),
          amount: lAmount,
          departmentId: lDepartmentId || undefined,
          projectId: lProjectId || undefined,
          notes: lNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to add budget line.");
      }
      toast.success("Budget line added.");
      setLineOpen(false);
      setLAccountCode(""); setLMonth("1"); setLAmount("");
      setLDepartmentId(""); setLProjectId(""); setLNotes("");
      // Reload detail + list
      await loadBudgetDetail(detailBudget.id);
      fetchBudgets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add budget line.");
    } finally {
      setSavingLine(false);
    }
  }

  async function handleDeleteLine(lineId: string) {
    if (!detailBudget) return;
    if (!confirm("Remove this budget line? This cannot be undone.")) return;
    setActionLoading(`del-${lineId}`);
    try {
      const res = await fetch(`/api/budgets/${detailBudget.id}/lines/${lineId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete line.");
      }
      toast.success("Budget line removed.");
      await loadBudgetDetail(detailBudget.id);
      fetchBudgets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete line.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTransition(action: "submit" | "approve" | "lock" | "cancel") {
    if (!detailBudget) return;
    const perm = action === "lock" ? "lock" : action;
    if (!can("budgets", perm)) {
      toast.error(`You don't have permission to ${action} budgets.`);
      return;
    }
    if (action === "cancel") {
      const reason = prompt("Reason for cancellation (optional):") || undefined;
      setActionLoading(action);
      try {
        const res = await fetch(`/api/budgets/${detailBudget.id}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to cancel budget.");
        }
        toast.success("Budget cancelled.");
        await loadBudgetDetail(detailBudget.id);
        fetchBudgets();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to cancel budget.");
      } finally {
        setActionLoading(null);
      }
      return;
    }
    setActionLoading(action);
    try {
      const res = await fetch(`/api/budgets/${detailBudget.id}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to ${action} budget.`);
      }
      toast.success(`Budget ${action}${action === "lock" ? "ed" : "ed"} successfully.`);
      await loadBudgetDetail(detailBudget.id);
      fetchBudgets();
      if (tab === "variance") fetchVarianceBudgets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action} budget.`);
    } finally {
      setActionLoading(null);
    }
  }

  // ----- No-permission guard -----
  if (!canViewBudgets) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Budgets & Forecast"
          description="Budget planning, variance analysis and cash flow forecasting"
        />
        <EmptyState
          icon={Wallet}
          title="No access"
          description="You do not have permission to view budgets."
        />
      </div>
    );
  }

  // ----- Render -----
  return (
    <div className="space-y-5">
      <PageHeader
        title="Budgets & Forecast"
        description="Budget planning, variance analysis and cash flow forecasting"
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="budgets">Budgets</TabsTrigger>
          <TabsTrigger value="variance">Variance Analysis</TabsTrigger>
          <TabsTrigger value="cash">Cash Forecast</TabsTrigger>
          <TabsTrigger value="forecast">Forecast Summary</TabsTrigger>
        </TabsList>

        {/* =============== BUDGETS TAB =============== */}
        <TabsContent value="budgets" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="Search by budget # or name…"
                value={searchBudgets}
                onChange={(e) => setSearchBudgets(e.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={statusBudgets} onValueChange={setStatusBudgets}>
                <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="FY"
                value={fyBudgets === "all" ? "" : fyBudgets}
                onChange={(e) => setFyBudgets(e.target.value || "all")}
                className="sm:w-24"
              />
            </div>
            {can("budgets", "create") && (
              <Button onClick={() => setBudgetOpen(true)}>
                <Plus className="h-4 w-4" /> New Budget
              </Button>
            )}
          </div>

          {loadingBudgets ? (
            <div className="space-y-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : budgets.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No budgets"
              description="Create your first budget to start planning income and expenses."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Budget #</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>FY</TableHead>
                        <TableHead className="text-center">Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Lines</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {budgets.map((b) => {
                        const lineCount = b.lineCount ?? b._count?.lines ?? 0;
                        return (
                          <TableRow
                            key={b.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => loadBudgetDetail(b.id)}
                          >
                            <TableCell className="font-mono text-xs">{b.budgetNumber}</TableCell>
                            <TableCell className="text-sm font-medium">{b.name}</TableCell>
                            <TableCell className="text-xs font-mono">{b.fiscalYear}</TableCell>
                            <TableCell className="text-center text-xs">{b.version}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={BUDGET_STATUS_BADGE[b.status] ?? ""}>
                                {b.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm font-semibold">{money(b.totalAmount)}</TableCell>
                            <TableCell className="text-right text-xs">{lineCount}</TableCell>
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

        {/* =============== VARIANCE ANALYSIS TAB =============== */}
        <TabsContent value="variance" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Label className="text-xs text-muted-foreground">Budget</Label>
              {loadingVarianceList ? (
                <Skeleton className="h-10 w-64" />
              ) : varianceBudgets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No approved or locked budgets available for variance analysis.
                </p>
              ) : (
                <Select value={varianceBudgetId} onValueChange={setVarianceBudgetId}>
                  <SelectTrigger className="w-full sm:w-80"><SelectValue placeholder="Select budget…" /></SelectTrigger>
                  <SelectContent>
                    {varianceBudgets.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.budgetNumber} — {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => fetchVariance()} disabled={loadingVariance || !varianceBudgetId}>
              {loadingVariance ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>

          {loadingVariance ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
              </div>
              <Skeleton className="h-64 w-full" />
            </div>
          ) : !varianceData ? (
            <EmptyState
              icon={Calculator}
              title="No variance data"
              description="Select an approved or locked budget to view variance analysis."
            />
          ) : (
            <>
              {/* KPI cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Total Budget</p>
                      <p className="mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">
                        {money(varianceData.totals.totalBudget)}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        FY {varianceData.budget.fiscalYear}
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-500/10 text-zinc-600 dark:text-zinc-300">
                      <Layers className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Total Actual</p>
                      <p className="mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">
                        {money(varianceData.totals.totalActual)}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        From Finance ledger
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <Banknote className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Total Variance</p>
                      <p className={`mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl ${Number(varianceData.totals.totalVariance) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {signedMoney(varianceData.totals.totalVariance)}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        Actual − Budget
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <TrendingUp className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Favorable</p>
                      <p className="mt-1 truncate text-xl font-bold tracking-tight text-emerald-600 sm:text-2xl">
                        {varianceData.totals.favorableCount}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">Account(s) on track</p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Unfavorable</p>
                      <p className="mt-1 truncate text-xl font-bold tracking-tight text-rose-600 sm:text-2xl">
                        {varianceData.totals.unfavorableCount}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">Account(s) off track</p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
                      <XCircle className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Income vs Expense breakdown */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ArrowUpCircle className="h-4 w-4 text-emerald-600" /> Income Budget vs Actual
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Budget</p>
                        <p className="font-semibold">{money(varianceData.totals.incomeBudget)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Actual</p>
                        <p className="font-semibold">{money(varianceData.totals.incomeActual)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Variance</p>
                        <p className={`font-semibold ${Number(varianceData.totals.incomeActual) - Number(varianceData.totals.incomeBudget) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {signedMoney((Number(varianceData.totals.incomeActual) - Number(varianceData.totals.incomeBudget)).toString())}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ArrowDownCircle className="h-4 w-4 text-rose-600" /> Expense Budget vs Actual
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Budget</p>
                        <p className="font-semibold">{money(varianceData.totals.expenseBudget)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Actual</p>
                        <p className="font-semibold">{money(varianceData.totals.expenseActual)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Variance</p>
                        <p className={`font-semibold ${Number(varianceData.totals.expenseActual) - Number(varianceData.totals.expenseBudget) <= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {signedMoney((Number(varianceData.totals.expenseActual) - Number(varianceData.totals.expenseBudget)).toString())}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Variance lines table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Calculator className="h-4 w-4" /> Variance by Budget Line
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {varianceData.byLine.length === 0 ? (
                    <div className="p-6">
                      <EmptyState
                        icon={Layers}
                        title="No budget lines"
                        description="This budget has no lines to analyze."
                      />
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Account Code</TableHead>
                            <TableHead>Class</TableHead>
                            <TableHead>Month</TableHead>
                            <TableHead className="text-right">Budget</TableHead>
                            <TableHead className="text-right">Actual</TableHead>
                            <TableHead className="text-right">Variance</TableHead>
                            <TableHead className="text-right">Var %</TableHead>
                            <TableHead>Classification</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {varianceData.byLine.map((ln) => {
                            const isUnfavorable = ln.classification === "unfavorable";
                            return (
                              <TableRow
                                key={ln.id}
                                className={isUnfavorable ? "bg-amber-500/5" : ""}
                              >
                                <TableCell>
                                  <div className="font-mono text-xs">{ln.ledgerAccountCode}</div>
                                  <div className="text-xs text-muted-foreground">{ln.accountName}</div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={ln.accountClass === "income" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}>
                                    {ln.accountClass}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs">{monthLabel(ln.month)}</TableCell>
                                <TableCell className="text-right text-xs">{money(ln.budgetAmount)}</TableCell>
                                <TableCell className="text-right text-xs">{money(ln.actualAmount)}</TableCell>
                                <TableCell className={`text-right text-xs font-medium ${Number(ln.variance) < 0 ? "text-rose-600" : Number(ln.variance) > 0 ? "text-emerald-600" : ""}`}>
                                  {signedMoney(ln.variance)}
                                </TableCell>
                                <TableCell className="text-right text-xs">{pct(ln.variancePct)}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={VARIANCE_CLASSIFICATION_BADGE[ln.classification] ?? ""}>
                                    {ln.classification}
                                  </Badge>
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
              <p className="text-xs text-muted-foreground">
                Period: {fmt(varianceData.period.from)} → {fmt(varianceData.period.to)}. Actuals sourced from the authoritative Finance ledger.
              </p>
            </>
          )}
        </TabsContent>

        {/* =============== CASH FORECAST TAB =============== */}
        <TabsContent value="cash" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Label htmlFor="horizon" className="text-xs text-muted-foreground">Horizon (days)</Label>
              <Input
                id="horizon"
                type="number"
                min={1}
                max={365}
                value={cashHorizon}
                onChange={(e) => setCashHorizon(e.target.value || "30")}
                className="sm:w-24"
              />
              <Button variant="outline" size="sm" onClick={() => fetchCashForecast()} disabled={loadingCash}>
                {loadingCash ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </div>

          {loadingCash ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
              </div>
              <Skeleton className="h-48 w-full" />
            </div>
          ) : !cashForecast ? (
            <EmptyState
              icon={PiggyBank}
              title="No cash forecast"
              description="Cash forecast could not be loaded."
            />
          ) : (
            <>
              {/* KPI cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Opening Cash</p>
                      <p className="mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">
                        {money(cashForecast.openingCash)}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">Today's balance</p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-500/10 text-zinc-600 dark:text-zinc-300">
                      <Wallet className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Expected Collections (AR)</p>
                      <p className="mt-1 truncate text-xl font-bold tracking-tight text-emerald-600 sm:text-2xl">
                        {money(cashForecast.expectedAR.total)}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {cashForecast.expectedAR.count} invoice(s) due
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <ArrowDownCircle className="h-5 w-5 rotate-180" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Expected Payments (AP)</p>
                      <p className="mt-1 truncate text-xl font-bold tracking-tight text-rose-600 sm:text-2xl">
                        {money(cashForecast.expectedAP.total)}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {cashForecast.expectedAP.count} bill(s) due
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
                      <ArrowUpCircle className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Planned Expenses</p>
                      <p className="mt-1 truncate text-xl font-bold tracking-tight text-amber-600 sm:text-2xl">
                        {money(cashForecast.plannedExpenses.total)}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {cashForecast.plannedExpenses.lineCount} budget line(s)
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <Target className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Projected Closing Cash</p>
                      <p className={`mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl ${Number(cashForecast.projectedClosingCash) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {money(cashForecast.projectedClosingCash)}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        Net {signedMoney(cashForecast.summary.netCashFlow)}
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <PiggyBank className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* AR details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ArrowDownCircle className="h-4 w-4 rotate-180 text-emerald-600" /> AR Collections Expected
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {cashForecast.expectedAR.invoices.length === 0 ? (
                    <div className="p-6">
                      <EmptyState
                        icon={FileText}
                        title="No outstanding AR within horizon"
                        description="All customer invoices due within this window are settled."
                      />
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Invoice #</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Invoice Total</TableHead>
                            <TableHead className="text-right">Balance Due</TableHead>
                            <TableHead>Due Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cashForecast.expectedAR.invoices.map((inv) => (
                            <TableRow key={inv.id}>
                              <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                              <TableCell className="text-sm font-medium">{inv.customer?.name ?? "—"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={inv.status === "partially_paid" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-sky-500/10 text-sky-700 dark:text-sky-300"}>
                                  {inv.status.replace("_", " ")}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right text-xs">{money(inv.total)}</TableCell>
                              <TableCell className="text-right text-sm font-semibold">{money(inv.balanceDue)}</TableCell>
                              <TableCell className="text-xs">{fmt(inv.dueDate)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* AP details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ArrowUpCircle className="h-4 w-4 text-rose-600" /> AP Payments Expected
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {cashForecast.expectedAP.bills.length === 0 ? (
                    <div className="p-6">
                      <EmptyState
                        icon={FileText}
                        title="No outstanding AP within horizon"
                        description="All supplier bills due within this window are settled."
                      />
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Bill #</TableHead>
                            <TableHead>Supplier</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Bill Total</TableHead>
                            <TableHead className="text-right">Balance Due</TableHead>
                            <TableHead>Due Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cashForecast.expectedAP.bills.map((b) => (
                            <TableRow key={b.id}>
                              <TableCell className="font-mono text-xs">{b.billNumber}</TableCell>
                              <TableCell className="text-sm font-medium">{b.supplier?.name ?? "—"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={b.status === "paid" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : b.status === "partially_paid" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-sky-500/10 text-sky-700 dark:text-sky-300"}>
                                  {b.status.replace("_", " ")}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right text-xs">{money(b.total)}</TableCell>
                              <TableCell className="text-right text-sm font-semibold">{money(b.balanceDue)}</TableCell>
                              <TableCell className="text-xs">{fmt(b.dueDate)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
              <p className="text-xs text-muted-foreground">
                Snapshot generated {fmtDateTime(cashForecast.generatedAt)} · Horizon: {cashForecast.horizonDays} day(s) · {fmt(cashForecast.period.from)} → {fmt(cashForecast.period.to)}
              </p>
            </>
          )}
        </TabsContent>

        {/* =============== FORECAST SUMMARY TAB =============== */}
        <TabsContent value="forecast" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Label htmlFor="fy" className="text-xs text-muted-foreground">Fiscal Year</Label>
              <Input
                id="fy"
                type="number"
                value={forecastFy}
                onChange={(e) => setForecastFy(e.target.value || String(new Date().getFullYear()))}
                className="sm:w-28"
              />
              <Label htmlFor="fhorizon" className="text-xs text-muted-foreground">Horizon (days)</Label>
              <Input
                id="fhorizon"
                type="number"
                min={1}
                max={365}
                value={forecastHorizon}
                onChange={(e) => setForecastHorizon(e.target.value || "30")}
                className="sm:w-24"
              />
              <Button variant="outline" size="sm" onClick={() => fetchForecastSummary()} disabled={loadingForecast}>
                {loadingForecast ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </div>

          {loadingForecast ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
              </div>
              <Skeleton className="h-48 w-full" />
            </div>
          ) : !forecastSummary ? (
            <EmptyState
              icon={TrendingUp}
              title="No forecast available"
              description="Forecast summary could not be loaded."
            />
          ) : (
            <>
              {/* Summary KPI cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {/* Total Budget vs Actual */}
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Total Budget vs Actual</p>
                      <p className="mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">
                        {money(forecastSummary.budgetTotals.totalBudget)}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        vs Actual {money(forecastSummary.actuals.netActual)}
                      </p>
                      <p className={`mt-1 truncate text-[11px] font-medium ${Number(forecastSummary.varianceSummary.netVariance) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        Net variance {signedMoney(forecastSummary.varianceSummary.netVariance)}
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <Layers className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
                {/* AR Outstanding */}
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">AR Outstanding</p>
                      <p className="mt-1 truncate text-xl font-bold tracking-tight text-emerald-600 sm:text-2xl">
                        {money(forecastSummary.arForecast.total)}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {forecastSummary.arForecast.count} outstanding invoice(s)
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <ArrowDownCircle className="h-5 w-5 rotate-180" />
                    </div>
                  </CardContent>
                </Card>
                {/* AP Outstanding */}
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">AP Outstanding</p>
                      <p className="mt-1 truncate text-xl font-bold tracking-tight text-rose-600 sm:text-2xl">
                        {money(forecastSummary.apForecast.total)}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {forecastSummary.apForecast.count} outstanding bill(s)
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
                      <ArrowUpCircle className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
                {/* Cash Opening vs Projected */}
                <Card>
                  <CardContent className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">Cash Opening vs Projected</p>
                      <p className="mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">
                        {money(forecastSummary.cashForecast.projectedClosingCash)}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        From {money(forecastSummary.cashForecast.openingCash)}
                      </p>
                      <p className={`mt-1 truncate text-[11px] font-medium ${Number(forecastSummary.cashForecast.projectedClosingCash) < Number(forecastSummary.cashForecast.openingCash) ? "text-rose-600" : "text-emerald-600"}`}>
                        Δ {signedMoney((Number(forecastSummary.cashForecast.projectedClosingCash) - Number(forecastSummary.cashForecast.openingCash)).toString())}
                      </p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <PiggyBank className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Detailed breakdown */}
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Layers className="h-4 w-4" /> Budget Performance
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Income Budget</p>
                        <p className="font-semibold text-emerald-700 dark:text-emerald-400">{money(forecastSummary.budgetTotals.incomeBudget)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Income Actual</p>
                        <p className="font-semibold text-emerald-700 dark:text-emerald-400">{money(forecastSummary.actuals.incomeActual)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Expense Budget</p>
                        <p className="font-semibold text-rose-700 dark:text-rose-400">{money(forecastSummary.budgetTotals.expenseBudget)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Expense Actual</p>
                        <p className="font-semibold text-rose-700 dark:text-rose-400">{money(forecastSummary.actuals.expenseActual)}</p>
                      </div>
                    </div>
                    <div className="border-t pt-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Active Budgets</p>
                        <p className="font-semibold">{forecastSummary.budgetTotals.activeBudgetCount}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Budget Lines</p>
                        <p className="font-semibold">{forecastSummary.budgetTotals.activeLineCount}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <PiggyBank className="h-4 w-4" /> Cash Flow Forecast
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Opening Cash</p>
                        <p className="font-semibold">{money(forecastSummary.cashForecast.openingCash)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Expected AR (in)</p>
                        <p className="font-semibold text-emerald-600">+{money(forecastSummary.cashForecast.expectedAR).replace("GHS ", "GHS ")}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Expected AP (out)</p>
                        <p className="font-semibold text-rose-600">−{money(forecastSummary.cashForecast.expectedAP).replace("GHS ", "GHS ")}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Planned Expenses</p>
                        <p className="font-semibold text-rose-600">−{money(forecastSummary.cashForecast.plannedExpenses).replace("GHS ", "GHS ")}</p>
                      </div>
                    </div>
                    <div className="border-t pt-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Projected Closing</p>
                        <p className={`font-bold ${Number(forecastSummary.cashForecast.projectedClosingCash) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {money(forecastSummary.cashForecast.projectedClosingCash)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Horizon</p>
                        <p className="font-semibold">{forecastSummary.horizonDays} day(s)</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Status breakdown */}
              {forecastSummary.statusBreakdown.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Calendar className="h-4 w-4" /> Budget Status Breakdown (FY {forecastSummary.fiscalYear})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Count</TableHead>
                            <TableHead className="text-right">Total Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {forecastSummary.statusBreakdown.map((s) => (
                            <TableRow key={s.status}>
                              <TableCell>
                                <Badge variant="outline" className={BUDGET_STATUS_BADGE[s.status] ?? ""}>
                                  {s.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right text-sm">{s.count}</TableCell>
                              <TableCell className="text-right text-sm font-semibold">{money(s.total)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
              <p className="text-xs text-muted-foreground">
                Generated {fmtDateTime(forecastSummary.generatedAt)} · FY {forecastSummary.fiscalYear} · {forecastSummary.horizonDays}-day forecast horizon.
              </p>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* =============== NEW BUDGET DIALOG =============== */}
      <Dialog open={budgetOpen} onOpenChange={setBudgetOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>New Budget</DialogTitle>
            <DialogDescription>
              Create a draft budget for a fiscal year. Lines can be added after creation; total is computed server-side.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="n-name">Budget Name *</Label>
              <Input id="n-name" value={nName} onChange={(e) => setNName(e.target.value)} placeholder="e.g. FY2025 Annual Operating Budget" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="n-desc">Description</Label>
              <Textarea id="n-desc" value={nDescription} onChange={(e) => setNDescription(e.target.value)} rows={2} placeholder="Optional notes about scope, assumptions…" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="n-fy">Fiscal Year *</Label>
                <Input id="n-fy" type="number" value={nFiscalYear} onChange={(e) => setNFiscalYear(e.target.value)} placeholder="e.g. 2025" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="n-cur">Currency</Label>
                <Input id="n-cur" value={nCurrency} onChange={(e) => setNCurrency(e.target.value)} maxLength={3} placeholder="GHS" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="n-start">Start Date *</Label>
                <Input id="n-start" type="date" value={nStartDate} onChange={(e) => setNStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="n-end">End Date *</Label>
                <Input id="n-end" type="date" value={nEndDate} onChange={(e) => setNEndDate(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBudgetOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-budget"
              onClick={handleCreateBudget}
              disabled={savingBudget || !nName.trim() || !nFiscalYear || !nStartDate || !nEndDate}
            >
              {savingBudget && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Budget
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =============== BUDGET DETAIL DIALOG =============== */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-[920px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {loadingDetail || !detailBudget ? (
                <Skeleton className="h-6 w-40" />
              ) : (
                <>
                  <span className="font-mono text-xs text-muted-foreground">{detailBudget.budgetNumber}</span>
                  <span>{detailBudget.name}</span>
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {detailBudget && (
                <>
                  FY {detailBudget.fiscalYear} · {fmt(detailBudget.startDate)} → {fmt(detailBudget.endDate)} · v{detailBudget.version}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {loadingDetail ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : detailBudget ? (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              {/* Status + totals */}
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="outline" className={BUDGET_STATUS_BADGE[detailBudget.status] ?? ""}>
                  {detailBudget.status}
                </Badge>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Total: <span className="font-semibold text-foreground">{money(detailBudget.totalAmount)}</span></span>
                  <span>Income: <span className="font-semibold text-emerald-600">{money(detailBudget.totalIncome)}</span></span>
                  <span>Expense: <span className="font-semibold text-rose-600">{money(detailBudget.totalExpense)}</span></span>
                  <span>Lines: <span className="font-semibold text-foreground">{detailBudget.lineCount}</span></span>
                </div>
              </div>

              {/* Description */}
              {detailBudget.description && (
                <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                  {detailBudget.description}
                </div>
              )}

              {/* Lifecycle / audit trail */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p className="font-medium">{fmtDateTime(detailBudget.createdAt)}</p>
                  <p className="text-muted-foreground">{detailBudget.createdBy?.username ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Submitted</p>
                  <p className="font-medium">{fmtDateTime(detailBudget.submittedAt)}</p>
                  <p className="text-muted-foreground">{detailBudget.submittedBy?.username ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Approved</p>
                  <p className="font-medium">{fmtDateTime(detailBudget.approvedAt)}</p>
                  <p className="text-muted-foreground">{detailBudget.approvedBy?.username ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Locked</p>
                  <p className="font-medium">{fmtDateTime(detailBudget.lockedAt)}</p>
                  <p className="text-muted-foreground">{detailBudget.lockedBy?.username ?? "—"}</p>
                </div>
              </div>

              {/* Action buttons (status + permission gated) */}
              <div className="flex flex-wrap gap-2 border-t pt-3">
                {detailBudget.status === "draft" && can("budgets", "submit") && (
                  <Button
                    type="button"
                    size="sm"
                    data-testid="submit-budget-action"
                    onClick={() => handleTransition("submit")}
                    disabled={actionLoading !== null || detailBudget.lineCount === 0}
                  >
                    {actionLoading === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Submit for Approval
                  </Button>
                )}
                {detailBudget.status === "submitted" && can("budgets", "approve") && (
                  <Button
                    type="button"
                    size="sm"
                    data-testid="approve-budget-action"
                    onClick={() => handleTransition("approve")}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Approve Budget
                  </Button>
                )}
                {detailBudget.status === "approved" && can("budgets", "lock") && (
                  <Button
                    type="button"
                    size="sm"
                    data-testid="lock-budget-action"
                    onClick={() => handleTransition("lock")}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "lock" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                    Lock Budget
                  </Button>
                )}
                {!["locked", "cancelled"].includes(detailBudget.status) && can("budgets", "cancel") && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="cancel-budget-action"
                    onClick={() => handleTransition("cancel")}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                    Cancel Budget
                  </Button>
                )}
                {detailBudget.status === "draft" && can("budgets", "edit") && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="add-line-action"
                    onClick={() => setLineOpen(true)}
                    disabled={actionLoading !== null}
                  >
                    <Plus className="h-4 w-4" /> Add Line
                  </Button>
                )}
                {["locked", "cancelled"].includes(detailBudget.status) && (
                  <p className="text-xs text-muted-foreground self-center">
                    Budget is {detailBudget.status} — no further edits allowed.
                  </p>
                )}
              </div>

              {/* Lines table */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Budget Lines</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {detailBudget.lines.length === 0 ? (
                    <div className="p-6">
                      <EmptyState
                        icon={Layers}
                        title="No budget lines yet"
                        description={detailBudget.status === "draft" ? "Add a line to begin building this budget." : "This budget has no lines."}
                      />
                    </div>
                  ) : (
                    <div className="overflow-x-auto max-h-72 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Account Code</TableHead>
                            <TableHead>Class</TableHead>
                            <TableHead>Month</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead>Department</TableHead>
                            <TableHead>Project</TableHead>
                            <TableHead>Notes</TableHead>
                            {detailBudget.status === "draft" && can("budgets", "edit") && <TableHead></TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detailBudget.lines.map((ln) => (
                            <TableRow key={ln.id}>
                              <TableCell>
                                <div className="font-mono text-xs">{ln.ledgerAccountCode}</div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={ln.accountClass === "income" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}>
                                  {ln.accountClass}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">{monthLabel(ln.month)}</TableCell>
                              <TableCell className="text-right text-sm font-semibold">{money(ln.amount)}</TableCell>
                              <TableCell className="text-xs">
                                {ln.department ? `${ln.department.code ?? ""} ${ln.department.name}`.trim() : "—"}
                              </TableCell>
                              <TableCell className="text-xs">
                                {ln.project ? `${ln.project.projectNumber} — ${ln.project.name}` : "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate" title={ln.notes ?? ""}>
                                {ln.notes ?? "—"}
                              </TableCell>
                              {detailBudget.status === "draft" && can("budgets", "edit") && (
                                <TableCell>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    data-testid={`delete-line-${ln.id}`}
                                    disabled={actionLoading === `del-${ln.id}`}
                                    onClick={() => handleDeleteLine(ln.id)}
                                    className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700"
                                  >
                                    {actionLoading === `del-${ln.id}` ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <XCircle className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =============== ADD BUDGET LINE DIALOG =============== */}
      <Dialog open={lineOpen} onOpenChange={setLineOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Add Budget Line</DialogTitle>
            <DialogDescription>
              Only income or expense ledger accounts can be budgeted. Total is recomputed server-side after save.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Ledger Account *</Label>
              <Select value={lAccountCode} onValueChange={setLAccountCode}>
                <SelectTrigger><SelectValue placeholder="Select income/expense account…" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {ledgerAccounts.map((a) => (
                    <SelectItem key={a.code} value={a.code}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Month *</Label>
                <Select value={lMonth} onValueChange={setLMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="l-amount">Amount *</Label>
                <Input id="l-amount" inputMode="decimal" value={lAmount} onChange={(e) => setLAmount(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Department (optional)</Label>
                <Select value={lDepartmentId} onValueChange={setLDepartmentId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.code ? `${d.code} — ${d.name}` : d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Project (optional)</Label>
                <Select value={lProjectId} onValueChange={setLProjectId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.projectNumber} — {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-notes">Notes</Label>
              <Textarea id="l-notes" value={lNotes} onChange={(e) => setLNotes(e.target.value)} rows={2} placeholder="Optional notes…" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLineOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-line"
              onClick={handleAddLine}
              disabled={savingLine || !lAccountCode || !lAmount || Number(lAmount) < 0}
            >
              {savingLine && <Loader2 className="h-4 w-4 animate-spin" />}
              Add Line
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
