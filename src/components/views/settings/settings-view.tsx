"use client";

// ============================================================================
// LBMS — Company Settings view
// ----------------------------------------------------------------------------
// Tabbed settings form bound to the singleton CompanySetting row. Backed by
// /api/company-settings (GET + PUT). Uses react-hook-form + zod for client
// validation; the same schema runs server-side in the route handler.
//
// Tabs:
//   1. Company Profile — identity, contact, address
//   2. Financial      — currency, financial-year, invoice numbering
//   3. Scope          — read-only Phase 1 scope note (other configurable
//                       entities live in their own modules)
//
// Behaviour:
//   - Users without `settings:edit` see a read-only form.
//   - MD always has edit rights (enforced server-side).
//   - A sticky footer Save bar is shown when the form is dirty.
//   - On successful save, `toast.success("Settings saved")` fires.
// ============================================================================

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Building2,
  Calculator,
  Info,
  Loader2,
  Save,
  ShieldCheck,
  Upload,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CompanySettingsRow {
  id: string;
  companyName: string;
  legalName: string | null;
  logoUrl: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  currency: string;
  currencySymbol: string;
  financialYearStart: string | null;
  invoicePrefix: string;
  invoiceStart: number;
  taxIdNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Form schema — mirrors the server-side schema in route.ts
// ---------------------------------------------------------------------------
const currencySchema = z
  .string()
  .trim()
  .length(3, "Currency must be a 3-letter ISO code (e.g. GHS).")
  .regex(/^[A-Z]{3}$/, "Currency must be 3 uppercase letters (e.g. GHS).");

const emailSchema = z
  .string()
  .trim()
  .max(200)
  .email("A valid email address is required.")
  .or(z.literal(""));

const settingsFormSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required.").max(200),
  legalName: z.string().trim().max(200).optional(),
  logoUrl: z.string().trim().max(2000).optional(),
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  country: z.string().trim().min(1, "Country is required.").max(100),
  phone: z.string().trim().max(50).optional(),
  email: emailSchema.optional(),
  website: z.string().trim().max(500).optional(),
  currency: currencySchema,
  currencySymbol: z
    .string()
    .trim()
    .min(1, "Currency symbol cannot be empty.")
    .max(20),
  financialYearStart: z
    .string()
    .trim()
    .max(10)
    .optional(),
  invoicePrefix: z.string().trim().min(1, "Invoice prefix is required.").max(20),
  invoiceStart: z
    .number({ error: "Invoice start must be a number." })
    .int("Invoice start must be a whole number.")
    .min(0, "Invoice start must be >= 0."),
  taxIdNumber: z.string().trim().max(100).optional(),
});

type SettingsFormValues = z.infer<typeof settingsFormSchema>;

// Default form values used on initial render / when no row exists yet.
const DEFAULT_VALUES: SettingsFormValues = {
  companyName: "Lightworld Tech",
  legalName: "",
  logoUrl: "",
  address: "",
  city: "",
  region: "",
  country: "Ghana",
  phone: "",
  email: "",
  website: "",
  currency: "GHS",
  currencySymbol: "GH\u20B5",
  financialYearStart: "",
  invoicePrefix: "INV-",
  invoiceStart: 1,
  taxIdNumber: "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function rowToFormValues(row: CompanySettingsRow): SettingsFormValues {
  return {
    companyName: row.companyName ?? "",
    legalName: row.legalName ?? "",
    logoUrl: row.logoUrl ?? "",
    address: row.address ?? "",
    city: row.city ?? "",
    region: row.region ?? "",
    country: row.country ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    website: row.website ?? "",
    currency: row.currency ?? "GHS",
    currencySymbol: row.currencySymbol ?? "GH\u20B5",
    financialYearStart: row.financialYearStart ?? "",
    invoicePrefix: row.invoicePrefix ?? "INV-",
    invoiceStart: row.invoiceStart ?? 0,
    taxIdNumber: row.taxIdNumber ?? "",
  };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "LT";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export function SettingsView() {
  const { user, isMD } = useAuth();
  const canEdit = isMD || (user ? user.permissions.includes("settings:edit") : false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [row, setRow] = useState<CompanySettingsRow | null>(null);
  const [activeTab, setActiveTab] = useState<string>("profile");

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: DEFAULT_VALUES,
    mode: "onChange",
  });

  // Load the singleton on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/company-settings", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const json = (await res.json()) as CompanySettingsRow;
        if (cancelled) return;
        setRow(json);
        form.reset(rowToFormValues(json));
      } catch {
        if (!cancelled) toast.error("Could not load company settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isDirty = form.formState.isDirty;

  async function onSubmit(values: SettingsFormValues) {
    setSaving(true);
    try {
      // Convert empty strings → null for optional/nullable fields so the DB
      // never stores empty strings.
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        payload[k] = v === "" ? null : v;
      }
      const res = await fetch("/api/company-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? "Save failed.");
      }
      const json = (await res.json()) as CompanySettingsRow;
      setRow(json);
      form.reset(rowToFormValues(json));
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  const companyName = form.watch("companyName") || row?.companyName || "Lightworld Tech";
  const logoUrl = form.watch("logoUrl") || row?.logoUrl || "";

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Company Settings</h2>
        <p className="text-sm text-muted-foreground">
          Manage your organisation&apos;s identity, currency and invoice defaults.
        </p>
      </div>

      {/* Company header card */}
      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
          {loading ? (
            <>
              <Skeleton className="h-16 w-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
            </>
          ) : (
            <>
              <Avatar className="h-16 w-16 rounded-xl border bg-muted">
                {logoUrl ? <AvatarImage src={logoUrl} alt={companyName} /> : null}
                <AvatarFallback className="rounded-xl bg-emerald-500/10 text-lg font-semibold text-emerald-700 dark:text-emerald-300">
                  {initials(companyName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-lg font-semibold">{companyName || "—"}</h3>
                  {canEdit ? (
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <ShieldCheck className="h-3 w-3" /> Can edit
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      Read-only
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {row?.legalName || "Legal name not set"} · {row?.country || "Ghana"}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Currency
                </span>
                <span className="text-sm font-semibold">
                  {row?.currency ?? "GHS"} ({row?.currencySymbol ?? "GH\u20B5"})
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="space-y-4 py-8">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </CardContent>
        </Card>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:grid-flow-col">
                <TabsTrigger value="profile" className="gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Company Profile</span>
                  <span className="sm:hidden">Profile</span>
                </TabsTrigger>
                <TabsTrigger value="financial" className="gap-1.5">
                  <Calculator className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Financial</span>
                  <span className="sm:hidden">Finance</span>
                </TabsTrigger>
                <TabsTrigger value="scope" className="gap-1.5">
                  <Info className="h-3.5 w-3.5" />
                  Scope
                </TabsTrigger>
              </TabsList>

              {/* Tab 1: Company Profile ---------------------------------- */}
              <TabsContent value="profile" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Company profile</CardTitle>
                    <CardDescription className="text-xs">
                      Identity and contact details shown across invoices, reports and the
                      application shell.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="companyName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Company name *</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Lightworld Tech"
                                disabled={!canEdit}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="legalName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Legal name</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Lightworld Tech Ltd"
                                disabled={!canEdit}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="logoUrl"
                        render={({ field }) => (
                          <FormItem className="md:col-span-2">
                            <FormLabel>Logo URL</FormLabel>
                            <div className="flex gap-2">
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder="https://cdn.example.com/logo.png"
                                  disabled={!canEdit}
                                  value={field.value ?? ""}
                                />
                              </FormControl>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled
                                className="shrink-0 gap-1.5"
                                title="Logo upload lands in Phase 10"
                              >
                                <Upload className="h-3.5 w-3.5" />
                                Upload
                              </Button>
                            </div>
                            <FormDescription className="text-xs">
                              Paste a URL for now. File upload arrives in Phase 10 (Documents).
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="address"
                        render={({ field }) => (
                          <FormItem className="md:col-span-2">
                            <FormLabel>Address</FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                placeholder="Street, building, postal code"
                                disabled={!canEdit}
                                value={field.value ?? ""}
                                rows={2}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Accra"
                                disabled={!canEdit}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="region"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Region / State</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Greater Accra"
                                disabled={!canEdit}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="country"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Country *</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Ghana"
                                disabled={!canEdit}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="taxIdNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tax ID number</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="TIN"
                                disabled={!canEdit}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="+233 30 000 0000"
                                disabled={!canEdit}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input
                                type="email"
                                {...field}
                                placeholder="info@lightworld.tech"
                                disabled={!canEdit}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="website"
                        render={({ field }) => (
                          <FormItem className="md:col-span-2">
                            <FormLabel>Website</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="https://lightworld.tech"
                                disabled={!canEdit}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Tab 2: Financial ---------------------------------------- */}
              <TabsContent value="financial" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Financial defaults</CardTitle>
                    <CardDescription className="text-xs">
                      Currency formatting and invoice numbering defaults used across all
                      financial modules.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="currency"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Currency code *</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="GHS"
                                disabled={!canEdit}
                                maxLength={3}
                                value={field.value ?? ""}
                                onChange={(e) =>
                                  field.onChange(e.target.value.toUpperCase())
                                }
                              />
                            </FormControl>
                            <FormDescription className="text-xs">
                              3-letter ISO 4217 code (e.g. GHS, USD, EUR).
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="currencySymbol"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Currency symbol *</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder={"GH\u20B5"}
                                disabled={!canEdit}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormDescription className="text-xs">
                              Shown next to monetary values throughout the app.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="financialYearStart"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Financial year start</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="01-01"
                                disabled={!canEdit}
                                maxLength={5}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormDescription className="text-xs">
                              Format <code className="font-mono">MM-DD</code> (e.g. 01-01 for
                              January 1st).
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="invoicePrefix"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Invoice prefix *</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder="INV-"
                                  disabled={!canEdit}
                                  value={field.value ?? ""}
                                />
                              </FormControl>
                              <FormDescription className="text-xs">
                                Prepended to the running invoice number.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="invoiceStart"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Invoice start number *</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min={0}
                                  step={1}
                                  disabled={!canEdit}
                                  value={Number.isFinite(field.value) ? field.value : 0}
                                  onChange={(e) =>
                                    field.onChange(
                                      e.target.value === "" ? 0 : Number(e.target.value),
                                    )
                                  }
                                />
                              </FormControl>
                              <FormDescription className="text-xs">
                                Next invoice will use this number. Must be ≥ 0.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                    <div className="mt-4 rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
                      <p>
                        <span className="font-medium text-foreground">Example:</span> prefix{" "}
                        <code className="font-mono">INV-</code> with start{" "}
                        <code className="font-mono">1</code> produces invoice numbers{" "}
                        <code className="font-mono">INV-0001</code>,{" "}
                        <code className="font-mono">INV-0002</code>, …
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Tab 3: Scope -------------------------------------------- */}
              <TabsContent value="scope" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Phase 1 scope</CardTitle>
                    <CardDescription className="text-xs">
                      Other configuration lives in dedicated modules — this view only manages
                      the global company profile + financial defaults.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <ScopeRow
                      label="Departments & Positions"
                      description="Manage organisational structure under the Administration area (Departments view)."
                      phase="Phase 1 — live"
                      live
                    />
                    <ScopeRow
                      label="Users & Roles"
                      description="User accounts, role assignments and permission grants live in the Users / Roles views."
                      phase="Phase 1 — live"
                      live
                    />
                    <ScopeRow
                      label="Audit log"
                      description="All company-settings changes are recorded in the Audit view under module 'settings'."
                      phase="Phase 1 — live"
                      live
                    />
                    <ScopeRow
                      label="Income / Expense categories"
                      description="Categorisation of income and expenditure will be configurable here once the Finance module lands."
                      phase="Phase 2"
                    />
                    <ScopeRow
                      label="Project statuses"
                      description="Custom project workflow statuses arrive with the Projects module."
                      phase="Phase 4"
                    />
                    <ScopeRow
                      label="Logo file upload"
                      description="A real file upload (with thumbnail + S3 storage) replaces the URL field on this page."
                      phase="Phase 10"
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Sticky save bar */}
            <SaveBar
              visible={canEdit}
              dirty={isDirty}
              saving={saving}
              onReset={() => form.reset()}
              onSave={() => form.handleSubmit(onSubmit)()}
            />
          </form>
        </Form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small internal components
// ---------------------------------------------------------------------------
function ScopeRow({
  label,
  description,
  phase,
  live = false,
}: {
  label: string;
  description: string;
  phase: string;
  live?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Badge
        variant={live ? "default" : "outline"}
        className={
          live
            ? "shrink-0 gap-1 bg-emerald-600 text-white hover:bg-emerald-600"
            : "shrink-0"
        }
      >
        {live && <ShieldCheck className="h-3 w-3" />}
        {phase}
      </Badge>
    </div>
  );
}

function SaveBar({
  visible,
  dirty,
  saving,
  onReset,
  onSave,
}: {
  visible: boolean;
  dirty: boolean;
  saving: boolean;
  onReset: () => void;
  onSave: () => void;
}) {
  return (
    <div
      className={
        "fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 transition-transform " +
        (visible && dirty ? "translate-y-0" : "translate-y-full")
      }
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          <span className="font-medium">Unsaved changes</span>
          <span className="hidden text-muted-foreground sm:inline">
            · review your edits before saving
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={onReset}
          >
            Discard
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={onSave}>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
