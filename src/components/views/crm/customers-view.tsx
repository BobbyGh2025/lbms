"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserCheck, Plus, Loader2, ChevronRight, MoreHorizontal, Pencil, Archive, Eye } from "lucide-react";
import { toast } from "sonner";

interface CustomerItem {
  id: string;
  customerNumber: string;
  customerType: string;
  legalName: string | null;
  tradingName: string | null;
  firstName: string | null;
  lastName: string | null;
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
  prospect: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  inactive: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  suspended: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  archived: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

function displayName(c: CustomerItem) {
  if (c.customerType === "individual" && (c.firstName || c.lastName)) {
    return `${c.firstName || ""} ${c.lastName || ""}`.trim();
  }
  return c.tradingName || c.legalName || c.customerNumber;
}

export function CustomersView() {
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<CustomerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Archive state
  const [archiveTarget, setArchiveTarget] = useState<CustomerItem | null>(null);
  const [archiveSaving, setArchiveSaving] = useState(false);

  // Form fields (shared for create + edit)
  const [customerType, setCustomerType] = useState("business");
  const [legalName, setLegalName] = useState("");
  const [tradingName, setTradingName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("active");

  const fetchCustomers = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("pageSize", "50");
      const res = await fetch(`/api/customers?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [search, statusFilter]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  function viewProfile(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "customer-profile");
    params.set("id", id);
    router.push(`?${params.toString()}`);
  }

  async function handleSubmit() {
    const name = customerType === "individual" ? undefined : (legalName.trim() || tradingName.trim());
    if (!name && customerType !== "individual") {
      toast.error("Please enter a legal or trading name.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerType,
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
        throw new Error(err.error || "Failed to create customer.");
      }
      const created = await res.json();
      toast.success(`Customer created: ${created.customerNumber}`);
      setCreateOpen(false);
      setLegalName(""); setTradingName(""); setEmail(""); setPhone(""); setCity(""); setIndustry(""); setWebsite(""); setAddress(""); setNotes("");
      fetchCustomers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create customer.");
    } finally {
      setSaving(false);
    }
  }

  async function openEdit(c: CustomerItem) {
    setEditingId(c.id);
    // Set all values from the list item first (dialog opens immediately)
    const ct = c.customerType || "business";
    setCustomerType(ct);
    setLegalName(c.legalName || "");
    setTradingName(c.tradingName || "");
    setEmail(c.email || "");
    setPhone(c.phone || "");
    setCity(c.city || "");
    setIndustry(c.industry || "");
    setStatus(c.status || "active");
    setWebsite("");
    setAddress("");
    setNotes("");
    setEditOpen(true);
    // Fetch full customer record for fields not in the list item
    try {
      const res = await fetch(`/api/customers/${c.id}`);
      if (res.ok) {
        const d = await res.json();
        const fct = d.customerType || ct;
        setCustomerType(fct);
        setStatus(d.status || c.status || "active");
        if (fct === "individual") {
          setLegalName(d.firstName || c.legalName || "");
          setTradingName(d.lastName || c.tradingName || "");
        } else {
          setLegalName(d.legalName || c.legalName || "");
          setTradingName(d.tradingName || c.tradingName || "");
        }
        setEmail(d.email || "");
        setPhone(d.phone || "");
        setCity(d.city || "");
        setIndustry(d.industry || "");
        setWebsite(d.website || "");
        setAddress(d.address || "");
        setNotes(d.notes || "");
      }
    } catch { /* use list values */ }
  }

  async function handleEditSubmit() {
    if (!editingId) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/customers/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerType,
          ...(customerType === "individual"
            ? {
                firstName: legalName.trim() || undefined,
                lastName: tradingName.trim() || undefined,
                legalName: null,
                tradingName: null,
              }
            : {
                legalName: legalName.trim() || undefined,
                tradingName: tradingName.trim() || undefined,
                firstName: null,
                lastName: null,
              }),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          city: city.trim() || undefined,
          industry: industry.trim() || undefined,
          website: website.trim() || undefined,
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
          status,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update customer.");
      }
      toast.success("Customer updated successfully.");
      setEditOpen(false);
      setEditingId(null);
      fetchCustomers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update customer.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleArchive() {
    if (!archiveTarget) return;
    setArchiveSaving(true);
    try {
      const res = await fetch(`/api/customers/${archiveTarget.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to archive customer.");
      }
      toast.success(`Customer ${displayName(archiveTarget)} archived.`);
      setArchiveTarget(null);
      fetchCustomers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to archive customer.");
    } finally {
      setArchiveSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customers"
        description="Manage customer relationships and master data."
        action={can("customers", "create") ? (
          <Button data-testid="customer-trigger" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New Customer
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
            <SelectItem value="prospect">Prospect</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={UserCheck} title="No customers found" description="Create your first customer to get started." />
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
                  {items.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => viewProfile(c.id)}>
                      <TableCell className="font-mono text-xs">{c.customerNumber}</TableCell>
                      <TableCell className="text-sm font-medium">{displayName(c)}</TableCell>
                      <TableCell className="text-xs capitalize">{c.customerType}</TableCell>
                      <TableCell className="text-xs">{c.industry || "—"}</TableCell>
                      <TableCell className="text-xs">{c.city || "—"}</TableCell>
                      <TableCell className="text-xs">{c._count?.contacts ?? 0}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_BADGE[c.status] ?? ""}>{c.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => viewProfile(c.id)}>
                              <Eye className="mr-2 h-4 w-4" /> View Profile
                            </DropdownMenuItem>
                            {can("customers", "edit") && (
                              <DropdownMenuItem onClick={() => openEdit(c)}>
                                <Pencil className="mr-2 h-4 w-4" /> Edit
                              </DropdownMenuItem>
                            )}
                            {can("customers", "delete") && c.status !== "archived" && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-rose-600"
                                  onClick={() => setArchiveTarget(c)}
                                >
                                  <Archive className="mr-2 h-4 w-4" /> Archive
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
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
            <DialogTitle>New Customer</DialogTitle>
            <DialogDescription>Create a customer master record.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Customer Type</Label>
              <Select value={customerType} onValueChange={setCustomerType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">Business</SelectItem>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="organization">Organization</SelectItem>
                  <SelectItem value="government">Government</SelectItem>
                  <SelectItem value="ngo">NGO</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {customerType !== "individual" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="cus-legal">Legal Name</Label>
                  <Input id="cus-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="e.g. Ghana Tech Solutions Ltd" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cus-trading">Trading Name</Label>
                  <Input id="cus-trading" value={tradingName} onChange={(e) => setTradingName(e.target.value)} placeholder="e.g. Ghana Tech" />
                </div>
              </>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cus-email">Email</Label>
                <Input id="cus-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cus-phone">Phone</Label>
                <Input id="cus-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+233 …" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cus-city">City</Label>
                <Input id="cus-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Accra" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cus-industry">Industry</Label>
                <Input id="cus-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Technology" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cus-website">Website</Label>
              <Input id="cus-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cus-address">Address</Label>
              <Input id="cus-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cus-notes">Notes</Label>
              <Textarea id="cus-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="button" data-testid="customer-submit" onClick={handleSubmit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) setEditingId(null); }}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
            <DialogDescription>Update customer master record.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Customer Type</Label>
              <Select value={customerType} onValueChange={setCustomerType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">Business</SelectItem>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="organization">Organization</SelectItem>
                  <SelectItem value="government">Government</SelectItem>
                  <SelectItem value="ngo">NGO</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-cus-status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="edit-cus-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="prospect">Prospect</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {customerType === "individual" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-cus-first">First Name</Label>
                  <Input id="edit-cus-first" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="e.g. John" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-cus-last">Last Name</Label>
                  <Input id="edit-cus-last" value={tradingName} onChange={(e) => setTradingName(e.target.value)} placeholder="e.g. Doe" />
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-cus-legal">Legal Name</Label>
                  <Input id="edit-cus-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="e.g. Ghana Tech Solutions Ltd" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-cus-trading">Trading Name</Label>
                  <Input id="edit-cus-trading" value={tradingName} onChange={(e) => setTradingName(e.target.value)} placeholder="e.g. Ghana Tech" />
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-cus-email">Email</Label>
                <Input id="edit-cus-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-cus-phone">Phone</Label>
                <Input id="edit-cus-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+233 …" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-cus-city">City</Label>
                <Input id="edit-cus-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Accra" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-cus-industry">Industry</Label>
                <Input id="edit-cus-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Technology" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-cus-website">Website</Label>
              <Input id="edit-cus-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-cus-address">Address</Label>
              <Input id="edit-cus-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-cus-notes">Notes</Label>
              <Textarea id="edit-cus-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setEditOpen(false); setEditingId(null); }}>Cancel</Button>
            <Button type="button" onClick={handleEditSubmit} disabled={editSaving}>
              {editSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive Confirm Dialog */}
      <ConfirmDialog
        trigger={null}
        title="Archive Customer"
        description={`Are you sure you want to archive ${archiveTarget ? displayName(archiveTarget) : "this customer"}? The customer will be marked as archived and excluded from active lists.`}
        confirmLabel="Archive"
        destructive
        open={!!archiveTarget}
        onOpenChange={(v) => { if (!v) setArchiveTarget(null); }}
        onConfirm={handleArchive}
      />
    </div>
  );
}
