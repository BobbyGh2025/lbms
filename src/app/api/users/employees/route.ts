// ============================================================================
// LBMS Users API — employee picker for the user form
// ----------------------------------------------------------------------------
// GET /api/users/employees?includeEmployeeId=<id>
// ----------------------------------------------------------------------------
// Returns active employees not currently linked to a (non-deleted) user.
// Used to populate the Employee <Select> in the Create/Edit user dialog.
//
// `includeEmployeeId` (optional) lets the Edit form include the employee that
// is already linked to the user being edited, so the dropdown can show the
// current value rather than appearing empty.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, ok } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const auth = await authorize("users", "view");
  if (!auth.ok) return auth.response;

  const includeEmployeeId =
    req.nextUrl.searchParams.get("includeEmployeeId") || undefined;

  // An employee is "available" when no active user points at it via the
  // User.employeeId FK. We also explicitly include the optional id so the
  // edit form can render the user's currently-linked employee.
  const employees = await db.employee.findMany({
    where: {
      deletedAt: null,
      status: { in: ["active", "on_leave"] },
      OR: [
        // Unlinked: no user points at this employee.
        { user: { is: null } },
        // Linked only to a soft-deleted user — treat as available.
        { user: { deletedAt: { not: null } } },
        // Always include the explicit one requested (for edit form).
        ...(includeEmployeeId ? [{ id: includeEmployeeId }] : []),
      ],
    },
    select: {
      id: true,
      employeeId: true,
      fullName: true,
      department: { select: { name: true } },
    },
    orderBy: { fullName: "asc" },
  });

  // De-duplicate by id (the OR conditions can return duplicates).
  const seen = new Set<string>();
  const items = employees
    .filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .map((e) => ({
      id: e.id,
      employeeId: e.employeeId,
      fullName: e.fullName,
      departmentName: e.department?.name ?? null,
    }));

  return ok({ items });
}
