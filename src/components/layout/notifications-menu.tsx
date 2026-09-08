"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: string;
  category: string | null;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

const TYPE_STYLES: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, 30000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  const unread = items.filter((i) => !i.isRead).length;

  async function markAllRead() {
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.map((i) => ({ ...i, isRead: true })));
      toast.success("All notifications marked as read");
    } catch {
      toast.error("Could not mark notifications as read");
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 sm:w-96">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {unread} new
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={markAllRead}
            disabled={unread === 0}
          >
            <CheckCheck className="mr-1 h-3.5 w-3.5" />
            Mark all read
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          <div className="divide-y">
            {loading && items.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Loading notifications…
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-muted-foreground">
                <Bell className="h-8 w-8 opacity-30" />
                <p className="text-sm">You&apos;re all caught up.</p>
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    "flex gap-3 px-4 py-3 transition-colors hover:bg-muted/50",
                    !n.isRead && "bg-primary/5",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      n.isRead ? "bg-transparent" : "bg-primary",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{n.title}</p>
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                          TYPE_STYLES[n.type] ?? TYPE_STYLES.info,
                        )}
                      >
                        {n.type}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {n.message}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground/70">
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
