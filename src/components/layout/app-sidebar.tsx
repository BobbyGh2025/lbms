"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Zap } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { NAV_GROUPS } from "@/lib/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";

export function AppSidebar() {
  const { user, isMD, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeView = searchParams.get("view") ?? "dashboard";

  function navigate(view: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    router.replace(`${pathname}?${params.toString()}`);
  }

  // Filter groups: keep group if at least one item is visible.
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => isMD || can(item.module, "view")),
  })).filter((g) => g.items.length > 0);

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Zap className="h-5 w-5" />
          </div>
          <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-bold">Lightworld Tech</span>
            <span className="truncate text-[11px] text-sidebar-foreground/60">
              Business Management
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <div className="px-3 py-1 group-data-[collapsible=icon]:hidden">
                <Badge
                  variant="outline"
                  className="border-primary/30 bg-primary/5 text-[10px] font-medium text-primary"
                >
                  Phase 1 · Foundation
                </Badge>
              </div>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {visibleGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeView === item.view;
                  const isPlanned = item.phase > 1;
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => navigate(item.view)}
                        tooltip={item.label}
                        className="cursor-pointer"
                      >
                        <Icon className="h-4 w-4" />
                        <span className="flex-1 truncate">{item.label}</span>
                        {isPlanned && (
                          <span className="ml-auto rounded bg-sidebar-accent px-1 py-0.5 text-[9px] font-medium text-sidebar-foreground/50">
                            P{item.phase}
                          </span>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 rounded-md border border-sidebar-border/50 px-3 py-2 group-data-[collapsible=icon]:hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
            {(user?.name || user?.email || "U").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-sidebar-foreground">
              {user?.name}
            </p>
            <p className="truncate text-[10px] text-sidebar-foreground/50">
              {user?.roles?.[0] ?? "user"}
            </p>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
