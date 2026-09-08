"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface KpiCardProps {
  label: string;
  value?: string | number;
  icon: LucideIcon;
  hint?: string;
  trend?: { value: string; positive?: boolean };
  loading?: boolean;
  accent?: "default" | "success" | "warning" | "danger" | "info";
}

const ACCENT_STYLES: Record<NonNullable<KpiCardProps["accent"]>, { iconBg: string; ring: string }> = {
  default: {
    iconBg: "bg-primary/10 text-primary",
    ring: "",
  },
  success: {
    iconBg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    ring: "",
  },
  warning: {
    iconBg: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    ring: "",
  },
  danger: {
    iconBg: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    ring: "",
  },
  info: {
    iconBg: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    ring: "",
  },
};

export function KpiCard({
  label,
  value,
  icon: Icon,
  hint,
  trend,
  loading,
  accent = "default",
}: KpiCardProps) {
  const styles = ACCENT_STYLES[accent];
  return (
    <Card className={cn("overflow-hidden transition-shadow hover:shadow-md", styles.ring)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="mt-2 h-7 w-24" />
            ) : (
              <p className="mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">
                {value ?? "—"}
              </p>
            )}
            {hint && !loading && (
              <p className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</p>
            )}
            {trend && !loading && (
              <p
                className={cn(
                  "mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium",
                  trend.positive ? "text-emerald-600" : "text-rose-600",
                )}
              >
                {trend.positive ? "▲" : "▼"} {trend.value}
              </p>
            )}
          </div>
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              styles.iconBg,
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
