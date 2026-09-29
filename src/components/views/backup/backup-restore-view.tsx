"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, DatabaseBackup, Download, Loader2, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";

interface BackupItem {
  id: string;
  fileName: string;
  size: number;
  createdAt: string;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function BackupRestoreView() {
  const { isMD, user } = useAuth();
  const canCreate = isMD || !!user?.permissions.includes("backup:create");
  const canDelete = isMD || !!user?.permissions.includes("backup:delete");
  const canRestore = isMD;

  const [items, setItems] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [label, setLabel] = useState("");
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/backup", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load backups.");
      setItems(json.items ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load backups.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function createBackup() {
    setWorking(true);
    try {
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Backup failed.");
      toast.success(`Backup created: ${json.fileName}`);
      setLabel("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Backup failed.");
    } finally {
      setWorking(false);
    }
  }

  async function restoreBackup() {
    if (!restoreId || confirmation !== "RESTORE") return;
    setWorking(true);
    try {
      const res = await fetch("/api/backup?action=restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: restoreId, confirmation }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Restore failed.");
      toast.success(`Restore completed. Safety backup: ${json.preRestoreBackup}`);
      setRestoreId(null);
      setConfirmation("");
      await load();
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setWorking(false);
    }
  }

  async function deleteBackup() {
    if (!deleteId) return;
    setWorking(true);
    try {
      const res = await fetch(`/api/backup?id=${encodeURIComponent(deleteId)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Delete failed.");
      toast.success("Backup deleted.");
      setDeleteId(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Backup & Restore</h2>
          <p className="text-sm text-muted-foreground">
            Create verified PostgreSQL database backups and restore the production database when authorised.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || working}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DatabaseBackup className="h-4 w-4" /> Create backup
          </CardTitle>
          <CardDescription>
            Backups are stored outside the application source tree and validated with PostgreSQL before being listed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="backup-label">Label (optional)</Label>
            <Input
              id="backup-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. before-month-end"
              maxLength={80}
              disabled={!canCreate || working}
            />
          </div>
          <Button onClick={() => void createBackup()} disabled={!canCreate || working}>
            {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Create Backup
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Backup history</CardTitle>
          <CardDescription>
            {items.length} backup{items.length === 1 ? "" : "s"} available. Keep an additional copy in secure off-host storage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading backups…</div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <DatabaseBackup className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-medium">No backups yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Create the first verified database backup.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString()} · {formatBytes(item.size)}
                    </p>
                  </div>
                  <Badge variant="outline">Verified</Badge>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <a href={`/api/backup?id=${encodeURIComponent(item.id)}&download=1`}>
                        <Download className="mr-2 h-4 w-4" /> Download
                      </a>
                    </Button>
                    {canRestore && (
                      <Button variant="outline" size="sm" onClick={() => { setRestoreId(item.id); setConfirmation(""); }} disabled={working}>
                        <RotateCcw className="mr-2 h-4 w-4" /> Restore
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="outline" size="sm" onClick={() => setDeleteId(item.id)} disabled={working}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-amber-500/30">
        <CardContent className="flex gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Restore is destructive</p>
            <p className="text-muted-foreground">
              Restore replaces current database objects with the selected backup. LBMS automatically creates a safety backup immediately before every restore. Only the Managing Director can perform the restore.
            </p>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!restoreId} onOpenChange={(open) => { if (!open && !working) { setRestoreId(null); setConfirmation(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore production database?</AlertDialogTitle>
            <AlertDialogDescription>
              This is destructive. A safety backup will be created first. Type RESTORE below to continue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value.toUpperCase())}
            placeholder="RESTORE"
            disabled={working}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={working || confirmation !== "RESTORE"} onClick={(e) => { e.preventDefault(); void restoreBackup(); }}>
              {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              Restore Database
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open && !working) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected backup from the production backup directory. It does not affect the live database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Separator />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={working} onClick={(e) => { e.preventDefault(); void deleteBackup(); }}>
              {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete Backup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
