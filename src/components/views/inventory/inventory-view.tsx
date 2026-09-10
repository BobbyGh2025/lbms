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
  Package, Warehouse, Boxes, ArrowLeftRight, Plus, Loader2,
  ChevronRight, ChevronLeft, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatAmount } from "@/lib/finance/money";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InventoryItemRow {
  id: string;
  itemCode: string;
  name: string;
  description: string | null;
  unitOfMeasure: string;
  reorderLevel: string;
  reorderQuantity: string;
  active: boolean;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  _count: { stockBalances: number; movements: number };
}

interface CategoryOption {
  id: string;
  name: string;
}

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  location: string | null;
  active: boolean;
  _count: { stockBalances: number; movements: number };
}

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
}

interface StockBalanceRow {
  id: string;
  quantity: string;
  inventoryItem: {
    id: string;
    itemCode: string;
    name: string;
    unitOfMeasure: string;
    reorderLevel: string;
    active: boolean;
  };
  warehouse: { id: string; code: string; name: string; active: boolean };
}

interface MovementRow {
  id: string;
  movementNumber: string;
  movementType: string;
  quantity: string;
  reason: string | null;
  notes: string | null;
  referenceType: string | null;
  referenceId: string | null;
  inventoryItem: { id: string; itemCode: string; name: string; unitOfMeasure: string };
  warehouse: { id: string; code: string; name: string };
  counterpartWarehouse: { id: string; code: string; name: string } | null;
  performedBy: { id: string; username: string };
  project: { id: string; projectNumber: string; name: string } | null;
  task: { id: string; taskNumber: string; title: string } | null;
  createdAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const MOVEMENT_BADGE: Record<string, string> = {
  RECEIPT: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  ISSUE: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  TRANSFER_IN: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  TRANSFER_OUT: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ADJUSTMENT_IN: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  ADJUSTMENT_OUT: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

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

function fmtQty(value: string | null | undefined, uom?: string) {
  if (!value) return "—";
  const n = Number(value);
  const txt = Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : value;
  return uom ? `${txt} ${uom}` : txt;
}

function fmtMovementLabel(type: string) {
  return type.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InventoryView() {
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("items");

  // ----- Items tab state -----
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [searchItems, setSearchItems] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [lowStockItemIds, setLowStockItemIds] = useState<Set<string>>(new Set());

  // ----- Warehouses tab state -----
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [loadingWh, setLoadingWh] = useState(true);
  const [whActiveFilter, setWhActiveFilter] = useState("all");

  // ----- Stock tab state -----
  const [stock, setStock] = useState<StockBalanceRow[]>([]);
  const [loadingStock, setLoadingStock] = useState(true);
  const [stockWhFilter, setStockWhFilter] = useState("all");
  const [stockLowOnly, setStockLowOnly] = useState(false);

  // ----- Movements tab state -----
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loadingMov, setLoadingMov] = useState(true);
  const [movPage, setMovPage] = useState(1);
  const [movPagination, setMovPagination] = useState<Pagination | null>(null);
  const [movSearch, setMovSearch] = useState("");
  const [movTypeFilter, setMovTypeFilter] = useState("all");

  // ----- Reference data -----
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);

  // ----- Create Item dialog -----
  const [itemOpen, setItemOpen] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [iCode, setICode] = useState("");
  const [iName, setIName] = useState("");
  const [iDesc, setIDesc] = useState("");
  const [iCategoryId, setICategoryId] = useState("");
  const [iUom, setIUom] = useState("unit");
  const [iReorderLevel, setIReorderLevel] = useState("0");
  const [iReorderQty, setIReorderQty] = useState("0");
  const [iActive, setIActive] = useState(true);

  // ----- Create Warehouse dialog -----
  const [whOpen, setWhOpen] = useState(false);
  const [savingWh, setSavingWh] = useState(false);
  const [wCode, setWCode] = useState("");
  const [wName, setWName] = useState("");
  const [wDesc, setWDesc] = useState("");
  const [wLocation, setWLocation] = useState("");
  const [wActive, setWActive] = useState(true);

  // ----- Fetchers -----
  const fetchItems = useCallback(async () => {
    try {
      setLoadingItems(true);
      const params = new URLSearchParams({ pageSize: "100" });
      if (searchItems) params.set("search", searchItems);
      if (categoryFilter !== "all") params.set("categoryId", categoryFilter);
      if (activeFilter !== "all") params.set("active", activeFilter);
      const [itemsRes, stockRes] = await Promise.all([
        fetch(`/api/inventory/items?${params}`),
        fetch("/api/inventory/stock"),
      ]);
      if (!itemsRes.ok) {
        toast.error("Failed to load inventory items.");
        return;
      }
      const data = await itemsRes.json();
      const rows: InventoryItemRow[] = data.items ?? [];
      setItems(rows);
      // Build low-stock itemId set from balances
      const lowSet = new Set<string>();
      if (stockRes.ok) {
        const sd = await stockRes.json();
        for (const b of (sd.items ?? []) as StockBalanceRow[]) {
          if (
            b.inventoryItem?.active &&
            Number(b.quantity) <= Number(b.inventoryItem.reorderLevel || 0)
          ) {
            lowSet.add(b.inventoryItem.id);
          }
        }
      }
      setLowStockItemIds(lowSet);
    } catch {
      toast.error("Failed to load inventory items.");
    } finally {
      setLoadingItems(false);
    }
  }, [searchItems, categoryFilter, activeFilter]);

  const fetchWarehouses = useCallback(async () => {
    try {
      setLoadingWh(true);
      const params = new URLSearchParams();
      if (whActiveFilter !== "all") params.set("active", whActiveFilter);
      const res = await fetch(`/api/inventory/warehouses?${params}`);
      if (!res.ok) {
        toast.error("Failed to load warehouses.");
        return;
      }
      const data = await res.json();
      setWarehouses(data.items ?? []);
    } catch {
      toast.error("Failed to load warehouses.");
    } finally {
      setLoadingWh(false);
    }
  }, [whActiveFilter]);

  const fetchStock = useCallback(async () => {
    try {
      setLoadingStock(true);
      const params = new URLSearchParams();
      if (stockWhFilter !== "all") params.set("warehouseId", stockWhFilter);
      if (stockLowOnly) params.set("lowStock", "true");
      const res = await fetch(`/api/inventory/stock?${params}`);
      if (!res.ok) {
        toast.error("Failed to load stock balances.");
        return;
      }
      const data = await res.json();
      setStock(data.items ?? []);
    } catch {
      toast.error("Failed to load stock balances.");
    } finally {
      setLoadingStock(false);
    }
  }, [stockWhFilter, stockLowOnly]);

  const fetchMovements = useCallback(async () => {
    try {
      setLoadingMov(true);
      const params = new URLSearchParams({
        page: String(movPage),
        pageSize: "20",
      });
      if (movSearch) params.set("search", movSearch);
      if (movTypeFilter !== "all") params.set("movementType", movTypeFilter);
      const res = await fetch(`/api/inventory/stock/movements?${params}`);
      if (!res.ok) {
        toast.error("Failed to load stock movements.");
        return;
      }
      const data = await res.json();
      setMovements(data.items ?? []);
      setMovPagination(data.pagination ?? null);
    } catch {
      toast.error("Failed to load stock movements.");
    } finally {
      setLoadingMov(false);
    }
  }, [movPage, movSearch, movTypeFilter]);

  // Load reference data on mount (categories + warehouses) for filters
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cRes, wRes] = await Promise.all([
          fetch("/api/inventory/categories"),
          fetch("/api/inventory/warehouses"),
        ]);
        if (cancelled) return;
        if (cRes.ok) {
          const cd = await cRes.json();
          setCategories((cd.items ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
        }
        if (wRes.ok) {
          const wd = await wRes.json();
          setWarehouseOptions((wd.items ?? []).map((w: { id: string; code: string; name: string }) => ({
            id: w.id, code: w.code, name: w.name,
          })));
        }
      } catch {
        /* silent */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { fetchWarehouses(); }, [fetchWarehouses]);
  useEffect(() => { fetchStock(); }, [fetchStock]);
  useEffect(() => { fetchMovements(); }, [fetchMovements]);

  // Reset movement page when filters change
  useEffect(() => { setMovPage(1); }, [movSearch, movTypeFilter]);

  // ----- Navigation -----
  function viewItem(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "inventory-item-profile");
    params.set("id", id);
    router.push(`?${params.toString()}`);
  }
  function viewWarehouse(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "warehouse-profile");
    params.set("id", id);
    router.push(`?${params.toString()}`);
  }

  // ----- Submit handlers -----
  async function handleCreateItem() {
    if (!iCode.trim()) { toast.error("Item code is required."); return; }
    if (!iName.trim()) { toast.error("Name is required."); return; }
    setSavingItem(true);
    try {
      const res = await fetch("/api/inventory/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemCode: iCode.trim(),
          name: iName.trim(),
          description: iDesc.trim() || undefined,
          categoryId: iCategoryId || undefined,
          unitOfMeasure: iUom.trim() || "unit",
          reorderLevel: iReorderLevel || "0",
          reorderQuantity: iReorderQty || "0",
          active: iActive,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create item.");
      }
      const created = await res.json();
      toast.success(`Item created: ${created.itemCode}`);
      setItemOpen(false);
      setICode(""); setIName(""); setIDesc(""); setICategoryId("");
      setIUom("unit"); setIReorderLevel("0"); setIReorderQty("0"); setIActive(true);
      fetchItems();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create item.");
    } finally {
      setSavingItem(false);
    }
  }

  async function handleCreateWarehouse() {
    if (!wCode.trim()) { toast.error("Warehouse code is required."); return; }
    if (!wName.trim()) { toast.error("Warehouse name is required."); return; }
    setSavingWh(true);
    try {
      const res = await fetch("/api/inventory/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: wCode.trim(),
          name: wName.trim(),
          description: wDesc.trim() || undefined,
          location: wLocation.trim() || undefined,
          active: wActive,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create warehouse.");
      }
      const created = await res.json();
      toast.success(`Warehouse created: ${created.code}`);
      setWhOpen(false);
      setWCode(""); setWName(""); setWDesc(""); setWLocation(""); setWActive(true);
      fetchWarehouses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create warehouse.");
    } finally {
      setSavingWh(false);
    }
  }

  // ----- Render -----
  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        description="Stock items, warehouses, balances and movements."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
        </TabsList>

        {/* ============== ITEMS TAB ============== */}
        <TabsContent value="items" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="Search by code or name…"
                value={searchItems}
                onChange={(e) => setSearchItems(e.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={activeFilter} onValueChange={setActiveFilter}>
                <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All items</SelectItem>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {can("inventory", "create") && (
              <Button onClick={() => setItemOpen(true)}>
                <Plus className="h-4 w-4" /> New Item
              </Button>
            )}
          </div>

          {loadingItems ? (
            <div className="space-y-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No inventory items"
              description="Create your first item to start tracking stock."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>UoM</TableHead>
                        <TableHead>Reorder Level</TableHead>
                        <TableHead>Active</TableHead>
                        <TableHead>Movements</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((it) => {
                        const isLow = lowStockItemIds.has(it.id);
                        return (
                          <TableRow
                            key={it.id}
                            className={`cursor-pointer hover:bg-muted/50 ${isLow ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}
                            onClick={() => viewItem(it.id)}
                          >
                            <TableCell className="font-mono text-xs">{it.itemCode}</TableCell>
                            <TableCell className="text-sm font-medium">{it.name}</TableCell>
                            <TableCell className="text-xs">{it.category?.name || "—"}</TableCell>
                            <TableCell className="text-xs">{it.unitOfMeasure}</TableCell>
                            <TableCell className="text-xs">{formatAmount(it.reorderLevel)}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={it.active
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}
                              >
                                {it.active ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">{it._count?.movements ?? 0}</TableCell>
                            <TableCell>
                              {isLow ? (
                                <AlertCircle className="inline h-4 w-4 text-amber-600 mr-1" />
                              ) : null}
                              <ChevronRight className="inline h-4 w-4 text-muted-foreground" />
                            </TableCell>
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

        {/* ============== WAREHOUSES TAB ============== */}
        <TabsContent value="warehouses" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Select value={whActiveFilter} onValueChange={setWhActiveFilter}>
              <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All warehouses</SelectItem>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Inactive</SelectItem>
              </SelectContent>
            </Select>
            {can("inventory", "create") && (
              <Button onClick={() => setWhOpen(true)}>
                <Plus className="h-4 w-4" /> New Warehouse
              </Button>
            )}
          </div>

          {loadingWh ? (
            <div className="space-y-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : warehouses.length === 0 ? (
            <EmptyState
              icon={Warehouse}
              title="No warehouses"
              description="Create your first warehouse to start tracking stock."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Active</TableHead>
                        <TableHead>Items</TableHead>
                        <TableHead>Movements</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {warehouses.map((w) => (
                        <TableRow
                          key={w.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => viewWarehouse(w.id)}
                        >
                          <TableCell className="font-mono text-xs">{w.code}</TableCell>
                          <TableCell className="text-sm font-medium">{w.name}</TableCell>
                          <TableCell className="text-xs">{w.location || "—"}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={w.active
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}
                            >
                              {w.active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{w._count?.stockBalances ?? 0}</TableCell>
                          <TableCell className="text-xs">{w._count?.movements ?? 0}</TableCell>
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

        {/* ============== STOCK TAB ============== */}
        <TabsContent value="stock" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Select value={stockWhFilter} onValueChange={setStockWhFilter}>
                <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All warehouses</SelectItem>
                  {warehouseOptions.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.code} — {w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={stockLowOnly}
                  onChange={(e) => setStockLowOnly(e.target.checked)}
                />
                <span>Low stock only</span>
              </label>
            </div>
          </div>

          {loadingStock ? (
            <div className="space-y-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : stock.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No stock balances"
              description="Stock balances appear once items are received into a warehouse."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item Code</TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead>Warehouse</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>UoM</TableHead>
                        <TableHead>Reorder Level</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stock.map((b) => {
                        const qty = Number(b.quantity);
                        const reorder = Number(b.inventoryItem.reorderLevel || 0);
                        const isLow = qty <= reorder;
                        return (
                          <TableRow
                            key={b.id}
                            className={`cursor-pointer hover:bg-muted/50 ${isLow ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}
                            onClick={() => viewItem(b.inventoryItem.id)}
                          >
                            <TableCell className="font-mono text-xs">{b.inventoryItem.itemCode}</TableCell>
                            <TableCell className="text-sm font-medium">{b.inventoryItem.name}</TableCell>
                            <TableCell className="text-xs">{b.warehouse.code} — {b.warehouse.name}</TableCell>
                            <TableCell className="text-sm font-medium">{fmtQty(b.quantity)}</TableCell>
                            <TableCell className="text-xs">{b.inventoryItem.unitOfMeasure}</TableCell>
                            <TableCell className="text-xs">{formatAmount(b.inventoryItem.reorderLevel)}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={isLow
                                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                  : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}
                              >
                                {isLow ? "Low Stock" : "In Stock"}
                              </Badge>
                            </TableCell>
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

        {/* ============== MOVEMENTS TAB ============== */}
        <TabsContent value="movements" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="Search by movement #…"
                value={movSearch}
                onChange={(e) => setMovSearch(e.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={movTypeFilter} onValueChange={setMovTypeFilter}>
                <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="RECEIPT">Receipt</SelectItem>
                  <SelectItem value="ISSUE">Issue</SelectItem>
                  <SelectItem value="TRANSFER_IN">Transfer In</SelectItem>
                  <SelectItem value="TRANSFER_OUT">Transfer Out</SelectItem>
                  <SelectItem value="ADJUSTMENT_IN">Adjustment In</SelectItem>
                  <SelectItem value="ADJUSTMENT_OUT">Adjustment Out</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {loadingMov ? (
            <div className="space-y-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : movements.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="No stock movements"
              description="Movements appear once you receive, issue, transfer, or adjust stock."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Movement #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Warehouse</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Performed By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {movements.map((m) => (
                        <TableRow key={m.id} className="hover:bg-muted/50">
                          <TableCell className="font-mono text-xs">{m.movementNumber}</TableCell>
                          <TableCell className="text-xs">{fmtDateTime(m.createdAt)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={MOVEMENT_BADGE[m.movementType] ?? ""}>
                              {fmtMovementLabel(m.movementType)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="font-mono">{m.inventoryItem.itemCode}</span>
                            <span className="text-muted-foreground"> — {m.inventoryItem.name}</span>
                          </TableCell>
                          <TableCell className="text-xs">{m.warehouse.code}</TableCell>
                          <TableCell className="text-sm font-medium">
                            {fmtQty(m.quantity, m.inventoryItem.unitOfMeasure)}
                          </TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate" title={m.reason || ""}>
                            {m.reason || "—"}
                          </TableCell>
                          <TableCell className="text-xs">{m.performedBy?.username || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pagination */}
          {movPagination && movPagination.totalPages > 1 && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Page {movPagination.page} of {movPagination.totalPages} · {movPagination.total} movements
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMovPage((p) => Math.max(1, p - 1))}
                  disabled={movPage <= 1 || loadingMov}
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMovPage((p) => Math.min(movPagination.totalPages, p + 1))}
                  disabled={movPage >= movPagination.totalPages || loadingMov}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ============== CREATE ITEM DIALOG ============== */}
      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>New Inventory Item</DialogTitle>
            <DialogDescription>Create a new stock-keeping item with a unique code.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="item-code">Item Code</Label>
                <Input id="item-code" value={iCode} onChange={(e) => setICode(e.target.value)} placeholder="e.g. CEM-50KG" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="item-name">Name</Label>
                <Input id="item-name" value={iName} onChange={(e) => setIName(e.target.value)} placeholder="e.g. Cement 50kg bag" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-desc">Description</Label>
              <Textarea id="item-desc" value={iDesc} onChange={(e) => setIDesc(e.target.value)} rows={2} placeholder="Optional description…" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={iCategoryId} onValueChange={setICategoryId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="item-uom">Unit of Measure</Label>
                <Input id="item-uom" value={iUom} onChange={(e) => setIUom(e.target.value)} placeholder="unit, kg, litre…" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="item-reorder-level">Reorder Level</Label>
                <Input id="item-reorder-level" value={iReorderLevel} onChange={(e) => setIReorderLevel(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="item-reorder-qty">Reorder Quantity</Label>
                <Input id="item-reorder-qty" value={iReorderQty} onChange={(e) => setIReorderQty(e.target.value)} placeholder="0" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={iActive}
                onChange={(e) => setIActive(e.target.checked)}
              />
              <span>Active (available for transactions)</span>
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setItemOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-item"
              onClick={handleCreateItem}
              disabled={savingItem || !iCode.trim() || !iName.trim()}
            >
              {savingItem && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== CREATE WAREHOUSE DIALOG ============== */}
      <Dialog open={whOpen} onOpenChange={setWhOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>New Warehouse</DialogTitle>
            <DialogDescription>Create a new physical storage location.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="wh-code">Warehouse Code</Label>
                <Input id="wh-code" value={wCode} onChange={(e) => setWCode(e.target.value)} placeholder="e.g. WH-MAIN" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wh-name">Name</Label>
                <Input id="wh-name" value={wName} onChange={(e) => setWName(e.target.value)} placeholder="e.g. Main Warehouse" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wh-desc">Description</Label>
              <Textarea id="wh-desc" value={wDesc} onChange={(e) => setWDesc(e.target.value)} rows={2} placeholder="Optional description…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wh-location">Location</Label>
              <Input id="wh-location" value={wLocation} onChange={(e) => setWLocation(e.target.value)} placeholder="e.g. Accra, Ghana" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={wActive}
                onChange={(e) => setWActive(e.target.checked)}
              />
              <span>Active (available for transactions)</span>
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setWhOpen(false)}>Cancel</Button>
            <Button
              type="button"
              data-testid="submit-warehouse"
              onClick={handleCreateWarehouse}
              disabled={savingWh || !wCode.trim() || !wName.trim()}
            >
              {savingWh && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Warehouse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
