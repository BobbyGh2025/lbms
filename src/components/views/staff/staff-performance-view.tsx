"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Award, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ReviewItem {
  id: string;
  employeeId: string;
  employeeName: string;
  reviewPeriod: string;
  reviewDate: string;
  reviewerId: string;
  reviewerName: string;
  rating: string | null;
  status: string;
}

interface EmployeeOption { id: string; fullName: string; employeeId: string; }
interface UserOption { id: string; username: string; email: string; }

export function StaffPerformanceView() {
  const { can } = useAuth();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [reviewers, setReviewers] = useState<UserOption[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [reviewPeriod, setReviewPeriod] = useState("");
  const [reviewDate, setReviewDate] = useState(new Date().toISOString().slice(0, 10));
  const [reviewerId, setReviewerId] = useState("");
  const [rating, setRating] = useState("");
  const [strengths, setStrengths] = useState("");
  const [improvementAreas, setImprovementAreas] = useState("");
  const [objectives, setObjectives] = useState("");
  const [comments, setComments] = useState("");

  const fetchReviews = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/staff/performance");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  useEffect(() => {
    if (!createOpen) return;
    (async () => {
      try {
        const [empRes, userRes] = await Promise.all([
          fetch("/api/staff?pageSize=100"),
          fetch("/api/users?pageSize=100"),
        ]);
        const emp = empRes.ok ? await empRes.json() : { items: [] };
        const users = userRes.ok ? await userRes.json() : { items: [] };
        setEmployees(emp.items ?? []);
        setReviewers(users.items ?? []);
      } catch { /* silent */ }
    })();
  }, [createOpen]);

  async function handleSubmit() {
    if (!employeeId || !reviewPeriod || !reviewDate || !reviewerId) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/staff/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId, reviewPeriod, reviewDate,
          reviewerId, rating: rating || undefined,
          strengths: strengths.trim() || undefined,
          improvementAreas: improvementAreas.trim() || undefined,
          objectives: objectives.trim() || undefined,
          comments: comments.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create review.");
      }
      toast.success("Performance review created.");
      setCreateOpen(false);
      setEmployeeId(""); setReviewPeriod(""); setRating("");
      setStrengths(""); setImprovementAreas(""); setObjectives(""); setComments("");
      fetchReviews();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create review.");
    } finally {
      setSaving(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  }

  const RATING_BADGE: Record<string, string> = {
    exceeds: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    meets: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    below: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Performance Reviews"
        description="Track employee performance reviews and appraisals."
        action={can("performance", "create") ? (
          <Button data-testid="performance-trigger" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New Review
          </Button>
        ) : null}
      />

      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Award} title="No performance reviews" description="Performance reviews will appear here once created." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Reviewer</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Review Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm font-medium">{item.employeeName}</TableCell>
                      <TableCell className="text-sm">{item.reviewPeriod}</TableCell>
                      <TableCell className="text-sm">{item.reviewerName}</TableCell>
                      <TableCell>
                        {item.rating ? (
                          <Badge variant="outline" className={RATING_BADGE[item.rating] ?? ""}>
                            {item.rating}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={item.status === "completed" ? "bg-emerald-500/10 text-emerald-700" : "bg-zinc-500/10"}>
                          {item.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{formatDate(item.reviewDate)}</TableCell>
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
            <DialogTitle>New Performance Review</DialogTitle>
            <DialogDescription>Create a performance review for an employee.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Employee</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="perf-period">Review Period</Label>
                <Input id="perf-period" value={reviewPeriod} onChange={(e) => setReviewPeriod(e.target.value)} placeholder="e.g. 2026-Q1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="perf-date">Review Date</Label>
                <Input id="perf-date" type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Reviewer</Label>
                <Select value={reviewerId} onValueChange={setReviewerId}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {reviewers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.username} ({u.email})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Rating</Label>
              <Select value={rating} onValueChange={setRating}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="exceeds">Exceeds Expectations</SelectItem>
                  <SelectItem value="meets">Meets Expectations</SelectItem>
                  <SelectItem value="below">Below Expectations</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perf-strengths">Strengths</Label>
              <Textarea id="perf-strengths" value={strengths} onChange={(e) => setStrengths(e.target.value)} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perf-improve">Improvement Areas</Label>
              <Textarea id="perf-improve" value={improvementAreas} onChange={(e) => setImprovementAreas(e.target.value)} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perf-objectives">Objectives</Label>
              <Textarea id="perf-objectives" value={objectives} onChange={(e) => setObjectives(e.target.value)} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perf-comments">Comments</Label>
              <Textarea id="perf-comments" value={comments} onChange={(e) => setComments(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="button" data-testid="performance-submit" onClick={handleSubmit} disabled={saving || !employeeId || !reviewPeriod || !reviewerId}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
