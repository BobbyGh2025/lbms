"use client";

// ============================================================================
// LBMS Staff Profile View
// ----------------------------------------------------------------------------
// Displays a single employee's complete profile: identity, contact,
// employment, emergency contacts, recent leave requests and performance
// reviews. Uses Tabs (Profile | Leave | Performance) to keep the layout
// scannable.
//
// The `employeeId` prop is supplied by the view router (which reads the
// `?id=` search param). If the employee is missing, a notFound card is
// shown with a "Back to Directory" button.
//
// All mutations are optimistic (refetch on success) and surface feedback
// via sonner toasts. The "Edit" button is gated client-side on
// can("staff","edit"); the API enforces the same rule server-side.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Pencil,
  Mail,
  Phone,
  MapPin,
  Calendar,
  UserCircle,
  Building2,
  Briefcase,
  UserCog,
  AlertTriangle,
  CalendarDays,
  Star,
  ShieldAlert,
} from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface EmergencyContact {
  id: string;
  name: string;
  relationship: string | null;
  phone: string;
  alternativePhone: string | null;
  address: string | null;
  isPrimary: boolean;
}

interface LeaveRequestRow {
  id: string;
  reference: string;
  leaveType: { id: string; name: string; code: string } | null;
  startDate: string;
  endDate: string;
  status: string;
  reason: string | null;
}

interface PerformanceReviewRow {
  id: string;
  reviewPeriod: string;
  reviewDate: string;
  reviewer: { id: string; name: string } | null;
  rating: string | null;
  status: string;
  comments: string | null;
}

interface EmployeeDetail {
  id: string;
  employeeId: string;
  employeeNumber: string | null;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  profilePhotoUrl: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  email: string | null;
  phone: string | null;
  alternativePhone: string | null;
  address: string | null;
  city: string | null;
  workLocation: string | null;
  department: { id: string; name: string } | null;
  position: { id: string; title: string } | null;
  employmentType: string | null;
  status: string;
  employmentDate: string | null;
  confirmationDate: string | null;
  endDate: string | null;
  manager: { id: string; fullName: string; employeeId: string } | null;
  notes: string | null;
  emergencyContacts: EmergencyContact[];
  leaveRequests: LeaveRequestRow[];
  performanceReviews: PerformanceReviewRow[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STATUS_BADGE: Record<string, { label: string; className: string; dot: string }> = {
  active: {
    label: "Active",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  probation: {
    label: "Probation",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  on_leave: {
    label: "On leave",
    className:
      "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
  },
  suspended: {
    label: "Suspended",
    className:
      "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    dot: "bg-rose-500",
  },
  inactive: {
    label: "Inactive",
    className:
      "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
    dot: "bg-zinc-400",
  },
};

const LEAVE_STATUS_BADGE: Record<string, string> = {
  pending:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rejected:
    "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  cancelled:
    "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
};

const REVIEW_STATUS_BADGE: Record<string, string> = {
  draft:
    "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
  completed:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

const RATING_BADGE: Record<string, { label: string; className: string }> = {
  exceeds: {
    label: "Exceeds",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  meets: {
    label: "Meets",
    className:
      "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  below: {
    label: "Below",
    className:
      "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  temporary: "Temporary",
  intern: "Intern",
  consultant: "Consultant",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function genderLabel(g: string | null) {
  if (!g) return "—";
  return g.charAt(0).toUpperCase() + g.slice(1);
}

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data?.error) return data.error as string;
  } catch {
    /* noop */
  }
  if (res.status === 401) return "You are not signed in.";
  if (res.status === 403) return "You are not authorized to perform this action.";
  if (res.status === 404) return "The employee was not found.";
  return `Request failed (${res.status}).`;
}

function daysBetween(start: string, end: string): number {
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const ms = b.getTime() - a.getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface StaffProfileViewProps {
  /** Employee id (cuid) from the `?id=` search param. Optional — if absent, reads from searchParams. */
  employeeId?: string;
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export function StaffProfileView({ employeeId: propEmployeeId }: StaffProfileViewProps = {}) {
  const { can } = useAuth();
  const canEdit = can("staff", "edit");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [data, setData] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const employeeId = propEmployeeId || searchParams.get("id") || "";

  function backToDirectory() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "staff-directory");
    params.delete("id");
    router.push(`${pathname}?${params.toString()}`);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        const res = await fetch(`/api/staff/${employeeId}`);
        if (res.status === 404) {
          if (!cancelled) {
            setNotFound(true);
            setData(null);
          }
          return;
        }
        if (!res.ok) throw new Error(await readError(res));
        const json: EmployeeDetail = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load employee.");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId, refreshKey]);

  if (loading) return <ProfileSkeleton />;

  if (notFound || !data) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Employee profile"
          description="The selected employee could not be found."
          action={
            <Button variant="outline" onClick={backToDirectory}>
              <ArrowLeft className="h-4 w-4" />
              Back to Directory
            </Button>
          }
        />
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Employee not found</p>
              <p className="text-xs text-muted-foreground">
                The employee may have been deleted, or the link is invalid.
              </p>
            </div>
            <Button variant="outline" onClick={backToDirectory}>
              <ArrowLeft className="h-4 w-4" />
              Back to Directory
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const sb = STATUS_BADGE[data.status] ?? {
    label: data.status,
    className:
      "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
    dot: "bg-zinc-400",
  };
  const empNumber = data.employeeNumber ?? data.employeeId;

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.fullName}
        description={`${empNumber} · ${data.position?.title ?? "—"} · ${data.department?.name ?? "—"}`}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={backToDirectory}>
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back to Directory</span>
              <span className="sm:hidden">Back</span>
            </Button>
            {canEdit ? (
              <Button data-testid={`employee-edit-${data.employeeId}`}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            ) : null}
          </div>
        }
      />

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------------- */}
        {/* PROFILE TAB                                                       */}
        {/* ---------------------------------------------------------------- */}
        <TabsContent value="profile" className="space-y-5">
          {/* Identity + status banner */}
          <Card>
            <CardContent className="p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Avatar className="h-16 w-16 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-lg font-bold text-primary">
                    {initials(data.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold">{data.fullName}</h3>
                    <Badge variant="outline" className={cn("gap-1.5", sb.className)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", sb.dot)} />
                      {sb.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {empNumber}
                    {data.preferredName ? ` · “${data.preferredName}”` : ""}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Identity */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <UserCircle className="h-4 w-4 text-primary" />
                  Identity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <DetailRow label="First name" value={data.firstName ?? "—"} />
                <DetailRow label="Last name" value={data.lastName ?? "—"} />
                <DetailRow
                  label="Date of birth"
                  value={formatDate(data.dateOfBirth)}
                  icon={<CalendarDays className="h-3.5 w-3.5" />}
                />
                <DetailRow label="Gender" value={genderLabel(data.gender)} />
              </CardContent>
            </Card>

            {/* Contact */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-primary" />
                  Contact
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <DetailRow
                  label="Email"
                  value={data.email ?? "—"}
                  icon={<Mail className="h-3.5 w-3.5" />}
                />
                <DetailRow
                  label="Phone"
                  value={data.phone ?? "—"}
                  icon={<Phone className="h-3.5 w-3.5" />}
                />
                <DetailRow
                  label="Alt. phone"
                  value={data.alternativePhone ?? "—"}
                />
                <DetailRow
                  label="Address"
                  value={data.address ?? "—"}
                  icon={<MapPin className="h-3.5 w-3.5" />}
                />
                <DetailRow label="City" value={data.city ?? "—"} />
                <DetailRow label="Work location" value={data.workLocation ?? "—"} />
              </CardContent>
            </Card>

            {/* Employment */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Briefcase className="h-4 w-4 text-primary" />
                  Employment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <DetailRow
                  label="Department"
                  value={data.department?.name ?? "—"}
                  icon={<Building2 className="h-3.5 w-3.5" />}
                />
                <DetailRow
                  label="Position"
                  value={data.position?.title ?? "—"}
                  icon={<Briefcase className="h-3.5 w-3.5" />}
                />
                <DetailRow
                  label="Employment type"
                  value={
                    data.employmentType
                      ? EMPLOYMENT_LABELS[data.employmentType] ?? data.employmentType
                      : "—"
                  }
                />
                <DetailRow label="Status" value={sb.label} />
                <DetailRow
                  label="Start date"
                  value={formatDate(data.employmentDate)}
                  icon={<Calendar className="h-3.5 w-3.5" />}
                />
                <DetailRow
                  label="Confirmation date"
                  value={formatDate(data.confirmationDate)}
                />
                <DetailRow
                  label="End date"
                  value={formatDate(data.endDate)}
                />
                <DetailRow
                  label="Manager"
                  value={data.manager ? data.manager.fullName : "—"}
                  icon={<UserCog className="h-3.5 w-3.5" />}
                />
              </CardContent>
            </Card>

            {/* Emergency contacts */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldAlert className="h-4 w-4 text-primary" />
                  Emergency contacts
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.emergencyContacts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No emergency contacts on file.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {data.emergencyContacts.map((c) => (
                      <li
                        key={c.id}
                        className="rounded-md border bg-muted/30 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{c.name}</p>
                          {c.isPrimary && (
                            <Badge
                              variant="outline"
                              className="border-primary/30 bg-primary/10 text-primary text-[10px]"
                            >
                              Primary
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {c.relationship ?? "—"} · {c.phone}
                        </p>
                        {c.alternativePhone && (
                          <p className="text-muted-foreground">
                            Alt: {c.alternativePhone}
                          </p>
                        )}
                        {c.address && (
                          <p className="text-muted-foreground">{c.address}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {data.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">HR notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {data.notes}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        {/* LEAVE TAB                                                         */}
        {/* ---------------------------------------------------------------- */}
        <TabsContent value="leave" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Recent leave requests</CardTitle>
            </CardHeader>
            <CardContent>
              {data.leaveRequests.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No leave requests on record.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead>Reference</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Start</TableHead>
                        <TableHead>End</TableHead>
                        <TableHead>Days</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.leaveRequests.map((lr) => (
                        <TableRow key={lr.id}>
                          <TableCell className="font-mono text-xs">
                            {lr.reference}
                          </TableCell>
                          <TableCell className="text-xs">
                            {lr.leaveType?.name ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {formatDate(lr.startDate)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {formatDate(lr.endDate)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {daysBetween(lr.startDate, lr.endDate)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] capitalize",
                                LEAVE_STATUS_BADGE[lr.status] ??
                                  "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
                              )}
                            >
                              {lr.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        {/* PERFORMANCE TAB                                                   */}
        {/* ---------------------------------------------------------------- */}
        <TabsContent value="performance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Performance reviews</CardTitle>
            </CardHeader>
            <CardContent>
              {data.performanceReviews.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No performance reviews on record.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead>Period</TableHead>
                        <TableHead>Review date</TableHead>
                        <TableHead>Reviewer</TableHead>
                        <TableHead>Rating</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Comments</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.performanceReviews.map((r) => {
                        const rating = r.rating
                          ? RATING_BADGE[r.rating] ?? {
                              label: r.rating,
                              className:
                                "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
                            }
                          : null;
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="text-xs font-medium">
                              {r.reviewPeriod}
                            </TableCell>
                            <TableCell className="text-xs">
                              {formatDate(r.reviewDate)}
                            </TableCell>
                            <TableCell className="text-xs">
                              {r.reviewer?.name ?? "—"}
                            </TableCell>
                            <TableCell>
                              {rating ? (
                                <Badge
                                  variant="outline"
                                  className={cn("text-[10px]", rating.className)}
                                >
                                  <Star className="h-3 w-3" />
                                  {rating.label}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] capitalize",
                                  REVIEW_STATUS_BADGE[r.status] ??
                                    "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300",
                                )}
                              >
                                {r.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-[280px] text-xs text-muted-foreground">
                              {r.comments ?? "—"}
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
        </TabsContent>
      </Tabs>

      <Separator />
      <p className="text-[11px] text-muted-foreground">
        Employee record loaded from <code className="font-mono">/api/staff/{employeeId}</code>.
        Last refreshed {new Date().toLocaleString()}.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small detail row helper
// ---------------------------------------------------------------------------
function DetailRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-right text-xs font-medium">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function ProfileSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-3 w-72" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Skeleton className="h-16 w-16 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <div
                  key={j}
                  className="flex items-center justify-between"
                >
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
