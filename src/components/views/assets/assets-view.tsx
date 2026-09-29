"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search, Pencil, Archive, Loader2, Package } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { formatMoney } from "@/lib/finance/money";

type Asset = {
  id: string;
  assetNumber: string;
  assetTag: string | null;
  name: string;
  category: string;
  description: string | null;
  serialNumber: string | null;
  condition: string;
  status: string;
  location: string | null;
  acquisitionDate: string | null;
  acquisitionCost: string;
  currentValue: string;
  currency: string;
  usefulLifeMonths: number | null;
  depreciationMethod: string;
  warrantyExpiry: string | null;
  custodian: { id: string; fullName: string; employeeNumber?: string | null; employeeId?: string | null } | null;
  supplier: { id: string; tradingName: string | null; legalName: string | null; supplierNumber?: string | null } | null;
  project: { id: string; name: string; projectNumber?: string | null } | null;
};

type Option = { id: string; name: string };

const STATUS = ["active", "maintenance", "disposed", "lost", "sold"];
const CONDITIONS = ["new", "good", "fair", "poor"];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateValue(v: string | null) { return v ? new Date(v).toISOString().slice(0, 10) : ""; }
function money(v: string) { return formatMoney(v, "GHS"); }

export function AssetsView() {
  const { can } = useAuth();
  const canCreate = can("assets", "create");
  const canEdit = can("assets", "edit");
  const canDelete = can("assets", "delete");

  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [employees, setEmployees] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Asset | null>(null);

  const blank = useMemo(() => ({
    name: "", category: "", assetTag: "", description: "", serialNumber: "",
    condition: "good", status: "active", location: "", acquisitionDate: todayISO(),
    acquisitionCost: "0", currentValue: "0", currency: "GHS", usefulLifeMonths: "",
    depreciationMethod: "none", warrantyExpiry: "", custodianId: "",
    supplierId: "", projectId: "", notes: "",
  }), []);

  const [form, setForm] = useState(blank);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: "1", pageSize: "100" });
      if (search.trim()) qs.set("search", search.trim());
      if (status !== "all") qs.set("status", status);
      if (category !== "all") qs.set("category", category);
      const res = await fetch(`/api/assets?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load assets.");
      const data = await res.json();
      setAssets(data.items ?? []);
      setCategories(data.categories ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load assets.");
    } finally { setLoading(false); }
  }, [search, status, category]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    Promise.all([
      fetch("/api/staff?page=1&pageSize=100"),
      fetch("/api/suppliers?page=1&pageSize=100"),
      fetch("/api/projects?page=1&pageSize=100"),
    ]).then(async ([e, s, p]) => {
      const [ed, sd, pd] = await Promise.all([
        e.ok ? e.json() : { items: [] },
        s.ok ? s.json() : { items: [] },
        p.ok ? p.json() : { items: [] },
      ]);
      setEmployees((ed.items ?? []).map((x: any) => ({ id: x.id, name: x.fullName })));
      setSuppliers((sd.items ?? []).map((x: any) => ({ id: x.id, name: x.tradingName || x.legalName || x.supplierNumber })));
      setProjects((pd.items ?? []).map((x: any) => ({ id: x.id, name: x.name })));
    }).catch(() => {});
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(blank);
    setDialogOpen(true);
  }
  function openEdit(a: Asset) {
    setEditing(a);
    setForm({
      name: a.name, category: a.category, assetTag: a.assetTag ?? "",
      description: a.description ?? "", serialNumber: a.serialNumber ?? "",
      condition: a.condition, status: a.status, location: a.location ?? "",
      acquisitionDate: dateValue(a.acquisitionDate), acquisitionCost: a.acquisitionCost,
      currentValue: a.currentValue, currency: a.currency,
      usefulLifeMonths: a.usefulLifeMonths ? String(a.usefulLifeMonths) : "",
      depreciationMethod: a.depreciationMethod, warrantyExpiry: dateValue(a.warrantyExpiry),
      custodianId: a.custodian?.id ?? "", supplierId: a.supplier?.id ?? "",
      projectId: a.project?.id ?? "", notes: a.notes ?? "",
    });
    setDialogOpen(true);
  }

  async function save() {
    if (!form.name.trim() || !form.category.trim()) {
      toast.error("Asset name and category are required."); return;
    }
    if (Number(form.currentValue) > Number(form.acquisitionCost)) {
      toast.error("Current value cannot exceed acquisition cost."); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        acquisitionCost: form.acquisitionCost || "0",
        currentValue: form.currentValue || "0",
        usefulLifeMonths: form.usefulLifeMonths ? Number(form.usefulLifeMonths) : undefined,
        assetTag: form.assetTag || undefined,
        description: form.description || undefined,
        serialNumber: form.serialNumber || undefined,
        location: form.location || undefined,
        acquisitionDate: form.acquisitionDate || undefined,
        warrantyExpiry: form.warrantyExpiry || undefined,
        custodianId: form.custodianId || undefined,
        supplierId: form.supplierId || undefined,
        projectId: form.projectId || undefined,
        notes: form.notes || undefined,
      };
      const res = await fetch(editing ? `/api/assets/${editing.id}` : "/api/assets", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Unable to save asset.");
      }
      toast.success(editing ? "Asset updated." : "Asset added.");
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to save asset.");
    } finally { setSaving(false); }
  }

  async function archive() {
    if (!archiveTarget) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/assets/${archiveTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Unable to archive asset.");
      }
      toast.success("Asset archived.");
      setArchiveTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to archive asset.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Assets"
        description="Register and track company-owned assets, custodians, locations and values."
        action={canCreate ? <Button onClick={openCreate}><Plus className="h-4 w-4" /> Add Asset</Button> : null}
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <Label>Search</Label>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Asset number, tag, name, serial…" />
          </div>
        </div>
        <div className="w-full md:w-48">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">All statuses</SelectItem>{STATUS.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
          </SelectContent></Select>
        </div>
        <div className="w-full md:w-56">
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">All categories</SelectItem>{categories.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
          </SelectContent></Select>
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        {loading ? <div className="space-y-3 p-5">{Array.from({length: 5}).map((_,i)=><Skeleton key={i} className="h-12 w-full" />)}</div> :
        assets.length === 0 ? <EmptyState icon={Package} title="No assets yet" description="Add your first company asset to start the register." action={canCreate ? <Button onClick={openCreate}>Add Asset</Button> : undefined} /> :
        <div className="overflow-x-auto"><Table><TableHeader><TableRow>
          <TableHead>Asset</TableHead><TableHead>Category</TableHead><TableHead>Status</TableHead><TableHead>Location</TableHead><TableHead>Custodian</TableHead><TableHead className="text-right">Value</TableHead><TableHead className="w-28" />
        </TableRow></TableHeader><TableBody>
          {assets.map(a => <TableRow key={a.id}>
            <TableCell><div className="font-medium">{a.name}</div><div className="text-xs text-muted-foreground">{a.assetNumber}{a.assetTag ? ` · ${a.assetTag}` : ""}</div></TableCell>
            <TableCell>{a.category}</TableCell>
            <TableCell><Badge variant="outline">{a.status}</Badge><div className="mt-1 text-xs text-muted-foreground">{a.condition}</div></TableCell>
            <TableCell>{a.location || "—"}</TableCell>
            <TableCell>{a.custodian?.fullName || "Unassigned"}</TableCell>
            <TableCell className="text-right">{money(a.currentValue)}</TableCell>
            <TableCell><div className="flex justify-end gap-1">
              {canEdit && <Button variant="ghost" size="icon" onClick={() => openEdit(a)} title="Edit"><Pencil className="h-4 w-4" /></Button>}
              {canDelete && <Button variant="ghost" size="icon" onClick={() => setArchiveTarget(a)} title="Archive"><Archive className="h-4 w-4" /></Button>}
            </div></TableCell>
          </TableRow>)}
        </TableBody></Table></div>}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>{editing ? "Edit Asset" : "Add Asset"}</DialogTitle><DialogDescription>{editing ? "Update the asset register record." : "Record a company-owned asset. This does not create a finance journal."}</DialogDescription></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>Name</Label><Input className="mt-1" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Dell Latitude Laptop" /></div>
            <div><Label>Category</Label><Input className="mt-1" value={form.category} onChange={e=>setForm({...form,category:e.target.value})} placeholder="IT Equipment" /></div>
            <div><Label>Asset Tag</Label><Input className="mt-1" value={form.assetTag} onChange={e=>setForm({...form,assetTag:e.target.value})} placeholder="LT-ASSET-001" /></div>
            <div><Label>Serial Number</Label><Input className="mt-1" value={form.serialNumber} onChange={e=>setForm({...form,serialNumber:e.target.value})} /></div>
            <div><Label>Acquisition Date</Label><Input type="date" className="mt-1" value={form.acquisitionDate} onChange={e=>setForm({...form,acquisitionDate:e.target.value})} /></div>
            <div><Label>Warranty Expiry</Label><Input type="date" className="mt-1" value={form.warrantyExpiry} onChange={e=>setForm({...form,warrantyExpiry:e.target.value})} /></div>
            <div><Label>Acquisition Cost</Label><Input inputMode="decimal" className="mt-1" value={form.acquisitionCost} onChange={e=>setForm({...form,acquisitionCost:e.target.value})} /></div>
            <div><Label>Current Value</Label><Input inputMode="decimal" className="mt-1" value={form.currentValue} onChange={e=>setForm({...form,currentValue:e.target.value})} /></div>
            <div><Label>Location</Label><Input className="mt-1" value={form.location} onChange={e=>setForm({...form,location:e.target.value})} placeholder="Head Office" /></div>
            <div><Label>Useful Life (months)</Label><Input type="number" min="1" className="mt-1" value={form.usefulLifeMonths} onChange={e=>setForm({...form,usefulLifeMonths:e.target.value})} /></div>
            <div><Label>Condition</Label><Select value={form.condition} onValueChange={v=>setForm({...form,condition:v})}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{CONDITIONS.map(x=><SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Status</Label><Select value={form.status} onValueChange={v=>setForm({...form,status:v})}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{STATUS.map(x=><SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Depreciation Method</Label><Select value={form.depreciationMethod} onValueChange={v=>setForm({...form,depreciationMethod:v})}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None / not calculated</SelectItem><SelectItem value="straight_line">Straight-line</SelectItem></SelectContent></Select></div>
            <div><Label>Custodian</Label><Select value={form.custodianId || "none"} onValueChange={v=>setForm({...form,custodianId:v==="none"?"":v})}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{employees.map(x=><SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Supplier</Label><Select value={form.supplierId || "none"} onValueChange={v=>setForm({...form,supplierId:v==="none"?"":v})}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{suppliers.map(x=><SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Project</Label><Select value={form.projectId || "none"} onValueChange={v=>setForm({...form,projectId:v==="none"?"":v})}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{projects.map(x=><SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="sm:col-span-2"><Label>Description</Label><Textarea className="mt-1" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} /></div>
            <div className="sm:col-span-2"><Label>Notes</Label><Textarea className="mt-1" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={()=>setDialogOpen(false)}>Cancel</Button><Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{editing ? "Save Changes" : "Add Asset"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!archiveTarget} onOpenChange={open=>!open && setArchiveTarget(null)}>
        <DialogContent><DialogHeader><DialogTitle>Archive asset?</DialogTitle><DialogDescription>{archiveTarget ? `This will archive ${archiveTarget.assetNumber} — ${archiveTarget.name}. The record remains in the audit trail.` : ""}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={()=>setArchiveTarget(null)}>Cancel</Button><Button variant="destructive" onClick={archive} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Archive Asset"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
