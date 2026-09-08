"use client";

import { useSearchParams } from "next/navigation";
import { Search, Menu } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { UserMenu } from "@/components/layout/user-menu";
import { NAV_ITEM_BY_VIEW } from "@/lib/navigation";

export function AppTopbar() {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "dashboard";
  const item = NAV_ITEM_BY_VIEW[view];
  const title = item?.label ?? "Dashboard";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 sm:px-4">
      <SidebarTrigger className="h-8 w-8" />
      <Separator orientation="vertical" className="mr-1 h-5" />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-sm font-semibold sm:text-base">{title}</h1>
      </div>

      <div className="hidden items-center md:flex">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search…"
            className="h-9 w-48 pl-8 text-sm lg:w-64"
            aria-label="Search"
          />
        </div>
      </div>

      <div className="flex items-center gap-0.5">
        <NotificationsMenu />
        <ThemeToggle />
        <Separator orientation="vertical" className="mx-1 h-5" />
        <UserMenu />
      </div>
    </header>
  );
}
