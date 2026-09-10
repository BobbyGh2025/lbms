// ============================================================================
// LBMS Permission Catalogue & Helpers
// ----------------------------------------------------------------------------
// Defines the canonical list of modules & actions used across the system.
// Provides server-side helpers to check permissions against the session.
// ============================================================================

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export type PermissionAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "approve"
  | "export"
  // Phase 2 finance-specific actions
  | "post"
  | "void"
  | "reverse"
  | "manage_accounts"
  | "manage_categories"
  | "view_reports"
  | "manage_opening_balances"
  // Phase 3 HR-specific actions
  | "view_sensitive"
  | "manage"
  | "reject"
  // Phase 7 procurement-specific actions
  | "submit"
  | "receive"
  | "cancel"
  // Phase 8 inventory-specific actions
  | "issue"
  | "transfer"
  | "adjust"
  // Phase 10 sales-specific actions
  | "pay";
  // Phase 11 AP/expense-specific actions reuse existing "post", "void", "approve", "submit"

/** Canonical module list. Keep in sync with prisma/seed.ts. */
export const PERMISSION_MODULES = [
  "dashboard",
  "finance",
  "accounts",
  "budgets",
  "receivables",
  "payables",
  "expenses",
  "staff",
  "departments",
  "tasks",
  "leave",
  "performance",
  "customers",
  "suppliers",
  "activities",
  "projects",
  "pipeline",
  "operations",
  "decisions",
  "approvals",
  "procurement",
  "inventory",
  "sales",
  "assets",
  "documents",
  "reports",
  "settings",
  "users",
  "roles",
  "audit",
  "notifications",
  "backup",
] as const;

export const PERMISSION_ACTIONS: PermissionAction[] = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "export",
];

export function permissionKey(module: string, action: PermissionAction): string {
  return `${module}:${action}`;
}

/**
 * Load a user's roles + flattened permission keys from the database.
 * Used during sign-in and session hydration.
 */
export async function loadUserAuthData(userId: string): Promise<{
  roles: string[];
  permissions: string[];
  isMD: boolean;
}> {
  const userRoles = await db.userRole.findMany({
    where: { userId },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  });

  const roles = userRoles.map((ur) => ur.role.name);
  const permSet = new Set<string>();
  for (const ur of userRoles) {
    for (const rp of ur.role.permissions) {
      permSet.add(permissionKey(rp.permission.module, rp.permission.action as PermissionAction));
    }
  }
  return {
    roles,
    permissions: Array.from(permSet),
    isMD: roles.includes("md"),
  };
}

// ---------------------------------------------------------------------------
// In-memory permission cache
// ----------------------------------------------------------------------------
// Permissions are NOT stored in the JWT (the JWT would exceed the 4KB cookie
// limit for the MD user who has all 150 permissions, causing NextAuth to
// chunk the cookie into 5 pieces and hit JWEInvalid on reassembly in
// Next.js 16 / Turbopack). Instead we keep a short-TTL in-memory cache keyed
// by userId and refresh from the DB when it expires or is explicitly
// invalidated (on role / role-permission mutations).
const PERM_CACHE_TTL_MS = 60_000; // 60 seconds
const permCache = new Map<string, { permissions: string[]; expiry: number }>();

/** Returns the cached permissions for a user, loading from DB on miss. */
export async function getUserPermissions(userId: string): Promise<string[]> {
  const cached = permCache.get(userId);
  const now = Date.now();
  if (cached && cached.expiry > now) {
    return cached.permissions;
  }
  const { permissions } = await loadUserAuthData(userId);
  permCache.set(userId, { permissions, expiry: now + PERM_CACHE_TTL_MS });
  return permissions;
}

/** Invalidate the cached permissions for a single user (call after user-role assignment). */
export function invalidateUserPermissionCache(userId: string): void {
  permCache.delete(userId);
}

/** Invalidate ALL cached permissions (call after role-permission mutations). */
export function invalidateAllPermissionCaches(): void {
  permCache.clear();
}

/**
 * Get the current server-side session. Thin wrapper around getServerSession.
 */
export async function getCurrentSession() {
  return getServerSession(authOptions);
}

/**
 * Require that the current user has the given permission. Throws an
 * AuthorizationError if unauthenticated or unauthorized.
 */
export class AuthorizationError extends Error {
  statusCode = 403;
  constructor(message = "You are not authorized to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class AuthenticationError extends Error {
  statusCode = 401;
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function requirePermission(
  module: string,
  action: PermissionAction,
): Promise<{ userId: string; isMD: boolean; roles: string[] }> {
  const session = await getCurrentSession();
  if (!session?.user) {
    throw new AuthenticationError();
  }
  // MD bypasses all permission checks
  if (session.user.isMD) {
    return { userId: session.user.id, isMD: true, roles: session.user.roles };
  }
  const key = permissionKey(module, action);
  if (!session.user.permissions.includes(key)) {
    throw new AuthorizationError();
  }
  return { userId: session.user.id, isMD: false, roles: session.user.roles };
}

/**
 * Soft check: returns true if the user has the permission (or is MD).
 * Use this for conditional UI rendering.
 */
export async function hasPermission(
  module: string,
  action: PermissionAction,
): Promise<boolean> {
  const session = await getCurrentSession();
  if (!session?.user) return false;
  if (session.user.isMD) return true;
  return session.user.permissions.includes(permissionKey(module, action));
}
