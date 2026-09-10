"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, Package, Boxes, ArrowLeftRight, ShieldCheck,
  ChevronLeft, ChevronRight, AlertCircle, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { formatAmount } from "@/lib/finance/money";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ItemDetail {
  id: string;
  itemCode: string;
  name: string;
  description: string | null;
  unitOfMeasure: string;
  reorderLevel: string;
  reorderQuantity: string;
  active: boolean;
  categoryId: string | null;
  category: { id: string; name: string; description: string | null } | null;
  createdBy: { id: string; username: string } | null;
  createdAt: string;
  updatedAt: string;
  stockBalances: StockBalanceRow[];
  movements: EmbeddedMovement[];
  _count: { movements: number };
}

interface StockBalanceRow {
  id: string;
  quantity: string;
  warehouse: { id: string; code: string; name: string };
}

interface EmbeddedMovement {
  id: string;
  movementNumber: string;
  movementType: string;
  quantity: string;
  reason: string | null;
  notes: string | null;
  warehouse: { id: string; code: string; name: string };
  performedBy: { id: string; username: string };
  createdAt: string;
}

interface MovementRow {
  id: string;
  movementNumber: string;
  movementType: string;
  quantity: string;
  reason: string | null;
  notes: string | null;
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

export function InventoryItemProfileView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  const [data, setData] = useState<ItemDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Movement history (paginated via dedicated endpoint for richer data)
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loadingMov, setLoadingMov] = useState(true);
  const [movPage, setMovPage] = useState(1);
  const [movPagination, setMovPagination] = useState<Pagination | null>(null);

  const fetchData = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    try {
      setLoading(true);
      const res = await fetch(`/api/inventory/items/${id}`);
      if (res.status === 404) { setData(null); return; }
      if (!res.ok) { toast.error("Failed to load inventory item."); return; }
      setData(await res.json());
    } catch {
      toast.error("Failed to load inventory item.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchMovements = useCallback(async () => {
    if (!id) { setLoadingMov(false); return; }
    try {
      setLoadingMov(true);
      const params = new URLSearchParams({
        inventoryItemId: id,
        page: String(movPage),
        pageSize: "20",
      });
      const res = await fetch(`/api/inventory/stock/movements?${params}`);
      if (!res.ok) { toast.error("Failed to load movements."); return; }
      const d = await res.json();
      setMovements(d.items ?? []);
      setMovPagination(d.pagination ?? null);
    } catch {
      toast.error("Failed to load movements.");
    } finally {
      setLoadingMov(false);
    }
  }, [id, movPage]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchMovements(); }, [fetchMovements]);

  function back() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "inventory");
    params.delete("id");
    router.push(`?${params.toString()}`);
  }

  function viewWarehouse(whId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "warehouse-profile");
    params.set("id", whId);
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
        icon={Package}
        title="No item selected"
        description="Choose an inventory item from the directory to view its profile."
        action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={Package}
        title="Item not found"
        description="This inventory item may have been removed."
        action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />
    );
  }

  const uom = data.unitOfMeasure || "unit";

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.name}
        description={`Item ${data.itemCode}`}
        action={<Button variant="outline" onClick={back}><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>}
      />

      {/* Header summary card */}
      <Card>
        <CardContent className="p-4 sm:p-6 flex flex-wrap items-center gap-3">
          <Badge
            variant="outline"
            className={data.active
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}
          >
            {data.active ? "Active" : "Inactive"}
          </Badge>
          {data.category && (
            <Badge variant="outline" className="bg-sky-500/10 text-sky-700 dark:text-sky-300">
              {data.category.name}
            </Badge>
          )}
          <div className="ml-auto text-xs text-muted-foreground">
            UoM <span className="font-medium">{uom}</span>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="stock">Stock by Warehouse ({data.stockBalances.length})</TabsTrigger>
          <TabsTrigger value="movements">Movement History ({data._count?.movements ?? 0})</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        {/* ============== OVERVIEW ============== */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Item Details</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Item Code" value={<span className="font-mono">{data.itemCode}</span>} />
                <Row label="Name" value={data.name} />
                <Row label="Category" value={data.category?.name || "—"} />
                <Row label="Unit of Measure" value={uom} />
                <Row label="Reorder Level" value={fmtQty(data.reorderLevel, uom)} />
                <Row label="Reorder Quantity" value={fmtQty(data.reorderQuantity, uom)} />
                <Row label="Active" value={
                  <Badge
                    variant="outline"
                    className={data.active
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}
                  >
                    {data.active ? "Yes" : "No"}
                  </Badge>
                } />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Description & Audit</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {data.description ? (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Description</p>
                    <p className="whitespace-pre-wrap">{data.description}</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No description provided.</p>
                )}
                {data.category?.description && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Category Description</p>
                    <p className="whitespace-pre-wrap text-xs">{data.category.description}</p>
                  </div>
                )}
                <div className="border-t pt-2 space-y-1 text-xs text-muted-foreground">
                  <Row label="Created" value={fmtDateTime(data.createdAt)} />
                  <Row label="Updated" value={fmtDateTime(data.updatedAt)} />
                  {data.createdBy && <Row label="Created By" value={data.createdBy.username} />}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ============== STOCK BY WAREHOUSE ============== */}
        <TabsContent value="stock" className="mt-4">
          {data.stockBalances.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No stock balances"
              description="This item has not yet been received into any warehouse."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Warehouse</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>UoM</TableHead>
                        <TableHead>Reorder Level</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.stockBalances.map((b) => {
                        const qty = Number(b.quantity);
                        const reorder = Number(data.reorderLevel || 0);
                        const isLow = qty <= reorder;
                        return (
                          <TableRow
                            key={b.id}
                            className={`cursor-pointer hover:bg-muted/50 ${isLow ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}
                            onClick={() => viewWarehouse(b.warehouse.id)}
                          >
                            <TableCell className="text-sm font-medium">
                              <span className="font-mono text-xs">{b.warehouse.code}</span>
                              <span className="text-muted-foreground"> — {b.warehouse.name}</span>
                            </TableCell>
                            <TableCell className="text-sm font-medium">{fmtQty(b.quantity)}</TableCell>
                            <TableCell className="text-xs">{uom}</TableCell>
                            <TableCell className="text-xs">{formatAmount(data.reorderLevel)}</TableCell>
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
                            <TableCell>
                              {isLow && <AlertCircle className="h-4 w-4 text-amber-600 inline mr-1" />}
                              <ChevronRight className="h-4 w-4 text-muted-foreground inline" />
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

        {/* ============== MOVEMENT HISTORY ============== */}
        <TabsContent value="movements" className="mt-4 space-y-4">
          {loadingMov ? (
            <div className="space-y-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : movements.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="No movements"
              description="No stock movements have been recorded for this item yet."
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
                        <TableHead>Warehouse</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Performed By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {movements.map((m) => (
                        <TableRow
                          key={m.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => viewWarehouse(m.warehouse.id)}
                        >
                          <TableCell className="font-mono text-xs">{m.movementNumber}</TableCell>
                          <TableCell className="text-xs">{fmtDateTime(m.createdAt)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={MOVEMENT_BADGE[m.movementType] ?? ""}>
                              {fmtMovementLabel(m.movementType)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{m.warehouse.code}</TableCell>
                          <TableCell className="text-sm font-medium">{fmtQty(m.quantity, uom)}</TableCell>
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
                Audit trail available in the Audit Trail module. Every action on this item
                (create, update, deactivate, receive, issue, transfer, adjust) is recorded
                with the actor, timestamp, and previous/new values for full traceability.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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
