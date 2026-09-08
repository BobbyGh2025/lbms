// ============================================================================
// LBMS Users API — role picker for the user form
// ----------------------------------------------------------------------------
// GET /api/users/roles
// ----------------------------------------------------------------------------
// Returns all active (non-deleted) roles for use in the user-form / manage-
// roles dialogs. This is a thin lookup helper — full role CRUD is the Roles
// module's responsibility (task 2-b).
// ============================================================================

import { db } from "@/lib/db";
import { authorize, ok } from "@/lib/api-helpers";

export async function GET() {
  const auth = await authorize("users", "view");
  if (!auth.ok) return auth.response;

  const roles = await db.role.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      displayName: true,
      isSystem: true,
      description: true,
    },
    orderBy: { displayName: "asc" },
  });

  return ok({
    items: roles.map((r) => ({
      id: r.id,
      name: r.name,
      displayName: r.displayName,
      isSystem: r.isSystem,
      description: r.description ?? null,
    })),
  });
}
