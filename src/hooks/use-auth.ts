"use client";

import { useSession } from "next-auth/react";

/**
 * Client-side permission helper. Returns the session plus convenience
 * methods for checking permissions and roles. For server-side enforcement
 * always use `requirePermission` from `@/lib/permissions`.
 */
export function useAuth() {
  const { data: session, status, update } = useSession();
  const user = session?.user;
  const isMD = !!user?.isMD;

  function can(module: string, action: string): boolean {
    if (!user) return false;
    if (isMD) return true;
    return user.permissions.includes(`${module}:${action}`);
  }

  function hasRole(roleName: string): boolean {
    if (!user) return false;
    return user.roles.includes(roleName);
  }

  function canAny(modules: string[], action: string): boolean {
    if (!user) return false;
    if (isMD) return true;
    return modules.some((m) => user.permissions.includes(`${m}:${action}`));
  }

  return {
    session,
    status,
    user,
    isMD,
    isAuthenticated: status === "authenticated",
    isLoading: status === "loading",
    can,
    hasRole,
    canAny,
    update,
  };
}
