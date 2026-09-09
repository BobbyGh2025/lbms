// ============================================================================
// LBMS API Helpers
// ----------------------------------------------------------------------------
// Shared utilities for API route handlers: authentication, authorization,
// audit logging, JSON responses and pagination. Keeps route handlers thin
// and consistent across modules.
// ============================================================================

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { recordAudit, type AuditAction } from "@/lib/audit";
import type { PermissionAction } from "@/lib/permissions";

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}

export async function getSession() {
  return getServerSession(authOptions);
}

export function unauthorized(): NextResponse<ApiError> {
  return NextResponse.json({ error: "Authentication required." }, { status: 401 });
}

export function forbidden(message = "You are not authorized to perform this action."): NextResponse<ApiError> {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function badRequest(message: string, details?: unknown): NextResponse<ApiError> {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function notFound(message = "Record not found."): NextResponse<ApiError> {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function ok<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}

/**
 * Authenticate + authorize an API request. Returns either the session user
 * context or a NextResponse (error) that the caller must return.
 */
export type AuthContext = {
  userId: string;
  isMD: boolean;
  roles: string[];
};

export async function authorize(
  module: string,
  action: PermissionAction,
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }> {
  const session = await getSession();
  if (!session?.user) {
    return { ok: false, response: unauthorized() };
  }
  const ctx: AuthContext = {
    userId: session.user.id,
    isMD: session.user.isMD,
    roles: session.user.roles,
  };
  if (ctx.isMD) return { ok: true, ctx };
  const key = `${module}:${action}`;
  if (!session.user.permissions.includes(key)) {
    return { ok: false, response: forbidden() };
  }
  return { ok: true, ctx };
}

export async function auditFromCtx(
  ctx: AuthContext,
  entry: {
    action: AuditAction;
    module: string;
    recordId?: string | null;
    recordType?: string | null;
    description?: string | null;
    previousValue?: unknown;
    newValue?: unknown;
  },
) {
  await recordAudit({ userId: ctx.userId, ...entry });
}

/** Parse pagination params from a URL search params. */
export function pagination(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "20") || 20));
  const search = searchParams.get("search")?.trim() || undefined;
  const status = searchParams.get("status") || undefined;
  return { page, pageSize, search, status, skip: (page - 1) * pageSize };
}

/** Common status filter helper for soft-deleted records. */
export function notDeleted() {
  return { deletedAt: null };
}
