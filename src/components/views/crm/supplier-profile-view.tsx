"use client";

import { useEffect, useState } from "react";
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
import { ArrowLeft, Truck, Phone, Mail, MapPin, Globe, Building, Calendar } from "lucide-react";

interface SupplierProfile {
  id: string;
  supplierNumber: string;
  supplierType: string;
  legalName: string | null;
  tradingName: string | null;
  email: string | null;
  phone: string | null;
  alternativePhone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string;
  industry: string | null;
  contactPerson: string | null;
  status: string;
  supplierSince: string | null;
  notes: string | null;
  accountManager: { id: string; fullName: string; employeeId: string } | null;
  contacts: Array<{
    id: string;
    firstName: string;
    lastName: string | null;
    jobTitle: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
    status: string;
  }>;
  activities: Array<{
    id: string;
    activityType: string;
    subject: string;
    status: string;
    dueDate: string | null;
    assignedToName: string | null;
  }>;
  journals: Array<{
    id: string;
    reference: string;
    transactionType: string;
    transactionDate: string;
    amount: string;
    currency: string;
    status: string;
    description: string | null;
  }>;
  // Phase 7: purchase orders linked to this supplier
  purchaseOrders: Array<{
    id: string;
    purchaseOrderNumber: string;
    status: string;
    orderDate: string;
    expectedDeliveryDate: string | null;
    total: string;
    currency: string;
    _count: { items: number };
  }>;
}

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  inactive: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  suspended: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  archived: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

export function SupplierProfileView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const [data, setData] = useState<SupplierProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`/api/suppliers/${id}`);
        if (!res.ok) { if (res.status === 404) setData(null); return; }
        const json = await res.json();
        setData(json);
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, [id]);

  function back() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "suppliers");
    params.delete("id");
    router.push(`?${params.toString()}`);
  }

  if (loading) return <div className="space-y-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!data) return <EmptyState icon={Truck} title="Supplier not found" description="This supplier may have been removed." action={<Button onClick={back} variant="outline"><ArrowLeft className="h-4 w-4" /> Back</Button>} />;

  const displayName = data.tradingName || data.legalName || data.supplierNumber;

  return (
    <div className="space-y-5">
      <PageHeader title={displayName} description={`Supplier ${data.supplierNumber}`} action={<Button variant="outline" onClick={back}><ArrowLeft className="h-4 w-4" /> Back to Directory</Button>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-sm">Identity</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Number" value={data.supplierNumber} />
            <Row label="Type" value={<span className="capitalize">{data.supplierType.replace("_", " ")}</span>} />
            {data.legalName && data.tradingName && data.legalName !== data.tradingName && <Row label="Legal Name" value={data.legalName} />}
            <Row label="Status" value={<Badge variant="outline" className={STATUS_BADGE[data.status] ?? ""}>{data.status}</Badge>} />
            <Row label="Industry" value={data.industry || "—"} />
            {data.supplierSince && <Row label="Supplier Since" value={new Date(data.supplierSince).toLocaleDateString()} />}
            {data.accountManager && <Row label="Account Manager" value={data.accountManager.fullName} />}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-sm">Contact</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.email && <ContactRow icon={Mail} label="Email" value={data.email} />}
            {data.phone && <ContactRow icon={Phone} label="Phone" value={data.phone} />}
            {data.alternativePhone && <ContactRow icon={Phone} label="Alt Phone" value={data.alternativePhone} />}
            {data.website && <ContactRow icon={Globe} label="Website" value={data.website} />}
            {data.address && <ContactRow icon={MapPin} label="Address" value={[data.address, data.city, data.region, data.country].filter(Boolean).join(", ")} />}
          </CardContent>
        </Card>

        {data.notes && (
          <Card className="lg:col-span-1">
            <CardHeader><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground whitespace-pre-wrap">{data.notes}</p></CardContent>
          </Card>
        )}
      </div>

      <Tabs defaultValue="contacts">
        <TabsList>
          <TabsTrigger value="contacts">Contacts ({data.contacts.length})</TabsTrigger>
          <TabsTrigger value="activities">Activities ({data.activities.length})</TabsTrigger>
          <TabsTrigger value="purchaseOrders">Purchase Orders ({data.purchaseOrders?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="finance">Finance ({data.journals.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="contacts" className="mt-4">
          {data.contacts.length === 0 ? (
            <EmptyState icon={Truck} title="No contacts" description="No contacts have been added for this supplier." />
          ) : (
            <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Title</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead><TableHead>Primary</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.contacts.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm">{c.firstName} {c.lastName || ""}</TableCell>
                    <TableCell className="text-xs">{c.jobTitle || "—"}</TableCell>
                    <TableCell className="text-xs">{c.email || "—"}</TableCell>
                    <TableCell className="text-xs">{c.phone || "—"}</TableCell>
                    <TableCell>{c.isPrimary && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700">Primary</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div></CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="activities" className="mt-4">
          {data.activities.length === 0 ? (
            <EmptyState icon={Calendar} title="No activities" description="No CRM activities for this supplier." />
          ) : (
            <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Subject</TableHead><TableHead>Status</TableHead><TableHead>Due</TableHead><TableHead>Assigned</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.activities.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs capitalize">{a.activityType.replace("_", " ")}</TableCell>
                    <TableCell className="text-sm">{a.subject}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{a.status}</Badge></TableCell>
                    <TableCell className="text-xs">{a.dueDate ? new Date(a.dueDate).toLocaleDateString() : "—"}</TableCell>
                    <TableCell className="text-xs">{a.assignedToName || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div></CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="purchaseOrders" className="mt-4">
          {!data.purchaseOrders || data.purchaseOrders.length === 0 ? (
            <EmptyState icon={Truck} title="No purchase orders" description="No purchase orders have been raised for this supplier." />
          ) : (
            <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>PO Number</TableHead><TableHead>Status</TableHead><TableHead>Order Date</TableHead><TableHead>Expected</TableHead><TableHead>Items</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.purchaseOrders.map(po => {
                  const active = po.status === "draft" || po.status === "pending_approval" || po.status === "approved" || po.status === "sent" || po.status === "partially_received";
                  return (
                    <TableRow key={po.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { const p = new URLSearchParams(searchParams.toString()); p.set("view", "purchase-order-profile"); p.set("id", po.id); router.push(`?${p.toString()}`); }}>
                      <TableCell className="font-mono text-xs">{po.purchaseOrderNumber}</TableCell>
                      <TableCell><Badge variant="outline" className={`text-xs ${active ? "bg-sky-500/10 text-sky-700" : po.status === "received" || po.status === "closed" ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-700"}`}>{po.status.replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="text-xs">{new Date(po.orderDate).toLocaleDateString()}</TableCell>
                      <TableCell className="text-xs">{po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-xs">{po._count.items}</TableCell>
                      <TableCell className="text-sm font-medium">{Number(po.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {po.currency || "GHS"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table></div></CardContent></Card>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">Purchase orders are procurement commitments. Financial obligations are recorded via the Finance posting engine only when a bill is posted (deferred).</p>
        </TabsContent>

        <TabsContent value="finance" className="mt-4">
          {data.journals.length === 0 ? (
            <EmptyState icon={Building} title="No transactions" description="No financial transactions reference this supplier." />
          ) : (
            <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Type</TableHead><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.journals.map(j => (
                  <TableRow key={j.id}>
                    <TableCell className="font-mono text-xs">{j.reference}</TableCell>
                    <TableCell className="text-xs capitalize">{j.transactionType}</TableCell>
                    <TableCell className="text-xs">{new Date(j.transactionDate).toLocaleDateString()}</TableCell>
                    <TableCell className="text-sm font-medium">{j.amount} {j.currency || "GHS"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{j.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div></CardContent></Card>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">Financial data comes from the authoritative Finance ledger. No AP balances are invented.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-2"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value || "—"}</span></div>;
}

function ContactRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return <div className="flex items-center gap-2"><Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" /><span className="text-muted-foreground text-xs">{label}:</span><span className="text-sm truncate">{value}</span></div>;
}
