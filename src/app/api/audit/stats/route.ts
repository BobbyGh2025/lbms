// ============================================================================
// LBMS Audit Trail Stats API (READ-ONLY)
// ----------------------------------------------------------------------------
// Lightweight summary of audit activity for the Audit Trail header cards.
// Returns total entries, entries in the last 24h, and top-8 modules + actions.
// ============================================================================

import { db } from "@/lib/db";
import { authorize, ok } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export interface AuditStatsResponse {
  total: number;
  last24h: number;
  byModule: Record<string, number>;
  byAction: Record<string, number>;
}

export async function GET() {
  const auth = await authorize("audit", "view");
  if (!auth.ok) return auth.response;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [total, last24h, byModuleRows, byActionRows] = await Promise.all([
    db.auditLog.count(),
    db.auditLog.count({ where: { createdAt: { gte: since24h } } }),
    db.auditLog.groupBy({
      by: ["module"],
      _count: { _all: true },
      orderBy: { _count: { module: "desc" } },
      take: 8,
    }),
    db.auditLog.groupBy({
      by: ["action"],
      _count: { _all: true },
      orderBy: { _count: { action: "desc" } },
    }),
  ]);

  const byModule: Record<string, number> = {};
  for (const r of byModuleRows) byModule[r.module] = r._count._all;

  const byAction: Record<string, number> = {};
  for (const r of byActionRows) byAction[r.action] = r._count._all;

  return ok<AuditStatsResponse>({ total, last24h, byModule, byAction });
}
