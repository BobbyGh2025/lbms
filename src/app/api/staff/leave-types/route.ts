// ============================================================================
// LBMS Staff API — Leave types (read-only)
// ----------------------------------------------------------------------------
// GET /api/staff/leave-types   list active leave types. leave:view.
// (Admin/HR management of leave types is handled via a future categories-style
//  admin route — for Phase 3 this endpoint is read-only.)
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, ok } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const auth = await authorize("leave", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const includeInactive = sp.get("includeInactive") === "true";

  const items = await db.leaveType.findMany({
    where: includeInactive ? {} : { status: "active" },
    orderBy: [{ name: "asc" }],
    include: {
      _count: {
        select: {
          leaveRequests: { where: { status: "pending" } },
        },
      },
    },
  });

  return ok({ items });
}
