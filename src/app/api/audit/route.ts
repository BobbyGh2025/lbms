// ============================================================================
// LBMS Audit Trail API (READ-ONLY)
// ----------------------------------------------------------------------------
// Audit logs are immutable at the application layer. This route exposes only
// a GET endpoint for listing/paginating/filtering audit entries. There are no
// POST / PATCH / DELETE endpoints — by design.
// ============================================================================

import { db } from "@/lib/db";
import { authorize, ok, badRequest, pagination } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export interface AuditListItem {
  id: string;
  userId: string | null;
  action: string;
  module: string;
  recordId: string | null;
  recordType: string | null;
  description: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  previousValue: string | null;
  newValue: string | null;
  createdAt: string;
  user: { id: string; email: string; name: string } | null;
}

export interface AuditListResponse {
  items: AuditListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function GET(req: Request) {
  const auth = await authorize("audit", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const sp = url.searchParams;
  const { page, pageSize, skip, search } = pagination(sp);

  const moduleFilter = sp.get("module")?.trim() || undefined;
  const actionFilter = sp.get("action")?.trim() || undefined;
  const userIdFilter = sp.get("userId")?.trim() || undefined;
  const from = sp.get("from")?.trim() || undefined;
  const to = sp.get("to")?.trim() || undefined;

  // Parse + validate dates defensively. Invalid dates return 400 rather
  // than a 500 from an unhandled Prisma error.
  let fromD: Date | undefined;
  let toAdjusted: Date | undefined;
  try {
    if (from) {
      fromD = new Date(from);
      if (isNaN(fromD.getTime())) throw new Error("Invalid 'from' date.");
    }
    if (to) {
      const toD = new Date(to);
      if (isNaN(toD.getTime())) throw new Error("Invalid 'to' date.");
      // If a date-only string was supplied (e.g. "2025-01-15") the resulting
      // `to` should cover that whole day.
      toAdjusted = /^\d{4}-\d{2}-\d{2}$/.test(to)
        ? new Date(toD.getTime() + 24 * 60 * 60 * 1000)
        : toD;
    }
  } catch {
    return badRequest(
      "Invalid date filter. Use ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ).",
    );
  }

  const where = {
    ...(search ? { description: { contains: search } } : {}),
    ...(moduleFilter ? { module: moduleFilter } : {}),
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(userIdFilter ? { userId: userIdFilter } : {}),
    ...(fromD || toAdjusted
      ? {
          createdAt: {
            ...(fromD ? { gte: fromD } : {}),
            ...(toAdjusted ? { lte: toAdjusted } : {}),
          },
        }
      : {}),
  };

  let rows, total;
  try {
    [rows, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        include: {
          user: {
            select: { id: true, email: true, username: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      db.auditLog.count({ where }),
    ]);
  } catch (err) {
    console.error("[audit] query failed:", err);
    return badRequest("Unable to fetch audit log entries.");
  }

  const items: AuditListItem[] = rows.map((a) => ({
    id: a.id,
    userId: a.userId,
    action: a.action,
    module: a.module,
    recordId: a.recordId,
    recordType: a.recordType,
    description: a.description,
    ipAddress: a.ipAddress,
    userAgent: a.userAgent,
    previousValue: a.previousValue,
    newValue: a.newValue,
    createdAt: a.createdAt.toISOString(),
    user: a.user
      ? { id: a.user.id, email: a.user.email, name: a.user.username }
      : null,
  }));

  return ok<AuditListResponse>({ items, total, page, pageSize });
}
