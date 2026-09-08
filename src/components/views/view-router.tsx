"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardView } from "@/components/views/dashboard/dashboard-view";
import { ComingSoonView } from "@/components/views/coming-soon/coming-soon-view";
import { UsersView } from "@/components/views/users/users-view";
import { RolesView } from "@/components/views/roles/roles-view";
import { DepartmentsView } from "@/components/views/departments/departments-view";
import { SettingsView } from "@/components/views/settings/settings-view";
import { AuditView } from "@/components/views/audit/audit-view";
import { NAV_ITEM_BY_VIEW } from "@/lib/navigation";

const PHASE1_VIEWS = new Set([
  "dashboard",
  "users",
  "roles",
  "departments",
  "settings",
  "audit",
]);

function ViewRouterInner() {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "dashboard";

  // Phase 1 implemented views
  if (view === "dashboard") return <DashboardView />;
  if (view === "users") return <UsersView />;
  if (view === "roles") return <RolesView />;
  if (view === "departments") return <DepartmentsView />;
  if (view === "settings") return <SettingsView />;
  if (view === "audit") return <AuditView />;

  // Validate that view is a known nav item (prevents arbitrary view injection)
  if (!NAV_ITEM_BY_VIEW[view]) return <DashboardView />;

  // Phase 2+ views render a "coming soon" placeholder
  return <ComingSoonView view={view} />;
}

export function ViewRouter() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[50vh] items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <ViewRouterInner />
    </Suspense>
  );
}
