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
import { Truck, Plus, Loader2, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface SupplierItem {
  id: string;
  supplierNumber: string;
  supplierType: string;
  legalName: string | null;
  tradingName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  status: string;
  industry: string | null;
  accountManagerName: string | null;
  _count?: { contacts: number; activities: number };
}

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  inactive: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  suspended: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  archived: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

function displayName(s: SupplierItem) {
  return s.tradingName || s.legalName || s.supplierNumber;
}

export function SuppliersView() {
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<SupplierItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [supplierType, setSupplierType] = useState("business");
  const [legalName, setLegalName] = useState("");
  const [tradingName, setTradingName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  const fetchSuppliers = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("pageSize", "50");
      const res = await fetch(`/api/suppliers?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [search, statusFilter]);

  useEffect(() => { fetchSuppliers(); }, [fetchSuppliers]);

  function viewProfile(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "supplier-profile");
    params.set("id", id);
    router.push(`?${params.toString()}`);
  }

  async function handleSubmit() {
    if (!legalName.trim() && !tradingName.trim()) {
      toast.error("Please enter a legal or trading name.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierType,
          legalName: legalName.trim() || undefined,
          tradingName: tradingName.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          city: city.trim() || undefined,
          industry: industry.trim() || undefined,
          website: website.trim() || undefined,
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create supplier.");
      }
      const created = await res.json();
      toast.success(`Supplier created: ${created.supplierNumber}`);
      setCreateOpen(false);
      setLegalName(""); setTradingName(""); setEmail(""); setPhone(""); setCity(""); setIndustry(""); setWebsite(""); setAddress(""); setNotes("");
      fetchSuppliers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create supplier.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Suppliers"
        description="Manage supplier relationships and master data."
        action={can("suppliers", "create") ? (
          <Button data-testid="supplier-trigger" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New Supplier
          </Button>
        ) : null}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by name, number, email, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Truck} title="No suppliers found" description="Create your first supplier to get started." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Industry</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Contacts</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => viewProfile(s.id)}>
                      <TableCell className="font-mono text-xs">{s.supplierNumber}</TableCell>
                      <TableCell className="text-sm font-medium">{displayName(s)}</TableCell>
                      <TableCell className="text-xs capitalize">{s.supplierType}</TableCell>
                      <TableCell className="text-xs">{s.industry || "—"}</TableCell>
                      <TableCell className="text-xs">{s.city || "—"}</TableCell>
                      <TableCell className="text-xs">{s._count?.contacts ?? 0}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_BADGE[s.status] ?? ""}>{s.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>New Supplier</DialogTitle>
            <DialogDescription>Create a supplier master record.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Supplier Type</Label>
              <Select value={supplierType} onValueChange={setSupplierType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">Business</SelectItem>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="contractor">Contractor</SelectItem>
                  <SelectItem value="service_provider">Service Provider</SelectItem>
                  <SelectItem value="government">Government</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-legal">Legal Name</Label>
              <Input id="sup-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="e.g. MTN Ghana" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-trading">Trading Name</Label>
              <Input id="sup-trading" value={tradingName} onChange={(e) => setTradingName(e.target.value)} placeholder="e.g. MTN" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sup-email">Email</Label>
                <Input id="sup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="orders@supplier.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-phone">Phone</Label>
                <Input id="sup-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+233 …" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sup-city">City</Label>
                <Input id="sup-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Accra" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-industry">Industry / Category</Label>
                <Input id="sup-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="IT Equipment" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-website">Website</Label>
              <Input id="sup-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-address">Address</Label>
              <Input id="sup-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-notes">Notes</Label>
              <Textarea id="sup-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="button" data-testid="supplier-submit" onClick={handleSubmit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Supplier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
