"use client";

import { Zap, ShieldCheck } from "lucide-react";

export function AppFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-auto border-t bg-background">
      <div className="flex flex-col items-center justify-between gap-3 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary">
            <Zap className="h-3.5 w-3.5" />
          </div>
          <span>
            <span className="font-semibold text-foreground">Lightworld Tech</span>{" "}
            · Business Management System
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <ShieldCheck className="h-3 w-3 text-emerald-600" />
            Phase 1 · Foundation
          </span>
          <span className="hidden sm:inline">·</span>
          <span>© {year} Lightworld Tech. All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
}
