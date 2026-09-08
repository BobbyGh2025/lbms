"use client";

import { signOut } from "next-auth/react";
import { LogOut, User as UserIcon, Settings, ShieldCheck } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

function initials(name: string) {
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
}

export function UserMenu() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(view: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    router.replace(`${pathname}?${params.toString()}`);
  }

  if (!user) return null;

  const primaryRole = user.roles[0] ?? "user";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex h-9 items-center gap-2 px-2 hover:bg-muted"
        >
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {initials(user.name || user.email) || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="hidden flex-col items-start leading-tight sm:flex">
            <span className="text-xs font-medium">{user.name}</span>
            <span className="text-[10px] text-muted-foreground">{primaryRole}</span>
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="text-sm font-semibold">{user.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => go("users")} className="cursor-pointer">
          <UserIcon className="mr-2 h-4 w-4" />
          My Account
        </DropdownMenuItem>
        {(user.isMD || user.permissions.includes("settings:view")) && (
          <DropdownMenuItem onClick={() => go("settings")} className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" />
            Company Settings
          </DropdownMenuItem>
        )}
        {(user.isMD || user.permissions.includes("roles:view")) && (
          <DropdownMenuItem onClick={() => go("roles")} className="cursor-pointer">
            <ShieldCheck className="mr-2 h-4 w-4" />
            Roles & Permissions
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer text-rose-600 focus:text-rose-700"
          onClick={() => signOut({ callbackUrl: "/" })}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
