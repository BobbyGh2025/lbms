"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, CircleAlert, Clock3, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Reminder = {
  id: string;
  title: string;
  message: string;
  type: string;
  category: string | null;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
};

const TYPE_STYLES: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export function RemindersView() {
  const [items, setItems] = useState<Reminder[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/notifications?generateReminders=true", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load reminders");
      const data = await res.json();
      setItems((data.items ?? []).filter((item: Reminder) => item.category === "reminder"));
    } catch {
      toast.error("Could not load reminders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "unread") return items.filter((item) => !item.isRead);
    if (filter === "overdue") return items.filter((item) => item.type === "error");
    if (filter === "today") return items.filter((item) => /today|overdue|due today/i.test(item.title + " " + item.message));
    return items;
  }, [filter, items]);

  const unread = items.filter((item) => !item.isRead).length;
  const overdue = items.filter((item) => item.type === "error").length;

  async function markAllRead() {
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.map((item) => ({ ...item, isRead: true })));
      toast.success("All reminders marked as read");
    } catch {
      toast.error("Could not mark reminders as read");
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reminder Center</h1>
          <p className="text-sm text-muted-foreground">
            Follow-ups, meetings, payments, deadlines and other actions that need attention.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={markAllRead} disabled={unread === 0}>
            <CheckCheck className="mr-2 h-4 w-4" />
            Mark all read
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total reminders</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{items.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Unread</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{unread}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Overdue / urgent</CardTitle></CardHeader>
          <CardContent><div className="flex items-center gap-2 text-2xl font-bold"><CircleAlert className="h-5 w-5 text-rose-500" />{overdue}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="overdue">Overdue</TabsTrigger>
              <TabsTrigger value="unread">Unread</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading reminders…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
              <Bell className="h-10 w-10 opacity-30" />
              <p className="font-medium">No reminders in this view.</p>
              <p className="text-xs">The system will generate new reminders automatically as business dates approach.</p>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((item) => (
                <div key={item.id} className={cn("flex gap-4 p-4", !item.isRead && "bg-primary/5")}>
                  <div className="mt-1">
                    {item.type === "error" ? <CircleAlert className="h-5 w-5 text-rose-500" /> : <Clock3 className="h-5 w-5 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{item.title}</h3>
                      <Badge variant="secondary" className={cn("text-[10px]", TYPE_STYLES[item.type] ?? TYPE_STYLES.info)}>
                        {item.type}
                      </Badge>
                      {!item.isRead && <Badge variant="outline" className="text-[10px]">New</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                    <p className="mt-2 text-xs text-muted-foreground/70">{new Date(item.createdAt).toLocaleString()}</p>
                  </div>
                  {item.linkUrl && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Open related record"
                      onClick={() => { window.location.href = item.linkUrl!; }}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
