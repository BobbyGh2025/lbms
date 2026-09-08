// ============================================================================
// LBMS Permissions API — catalogue endpoint
// ----------------------------------------------------------------------------
// GET /api/permissions   — list ALL permissions grouped by module
//                          { modules: [{ module, permissions: [{id, module, action}] }] }
// ----------------------------------------------------------------------------
// Used by the Roles view to render the permission matrix. Order follows the
// canonical PERMISSION_MODULES list from `@/lib/permissions`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, ok } from "@/lib/api-helpers";
import { PERMISSION_MODULES } from "@/lib/permissions";

export async function GET(_req: NextRequest) {
  const auth = await authorize("roles", "view");
  if (!auth.ok) return auth.response;

  const perms = await db.permission.findMany({
    orderBy: [{ module: "asc" }, { action: "asc" }],
    select: { id: true, module: true, action: true },
  });

  // Group by module, preserving canonical order.
  const byModule = new Map<string, { id: string; module: string; action: string }[]>();
  for (const p of perms) {
    const arr = byModule.get(p.module) ?? [];
    arr.push({ id: p.id, module: p.module, action: p.action });
    byModule.set(p.module, arr);
  }

  const modules = PERMISSION_MODULES.map((module) => ({
    module,
    permissions: byModule.get(module) ?? [],
  })).filter((m) => m.permissions.length > 0);

  return ok({ modules });
}
