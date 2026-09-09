// ============================================================================
// LBMS Staff API — Deactivate employee
// ----------------------------------------------------------------------------
// POST /api/staff/[id]/deactivate   soft-deactivate: set status="inactive"
//                                   and deletedAt=now. Block if the employee
//                                   has any pending leave requests. Requires
//                                   staff:delete (or staff:manage). Audit
//                                   recorded. Never hard-deletes.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
  badRequest,
  notFound,
  auditFromCtx,
  notDeleted,
} from "@/lib/api-helpers";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const DeactivateSchema = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  // Allow either staff:delete OR staff:manage
  let auth = await authorize("staff", "delete");
  if (!auth.ok) {
    const manage = await authorize("staff", "manage");
    if (!manage.ok) {
      return auth.response; // return the original "delete" denial for a stable error
    }
    auth = manage;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = DeactivateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }

  const existing = await db.employee.findFirst({
    where: { id, ...notDeleted() },
    include: {
      user: { select: { id: true } },
    },
  });
  if (!existing) return notFound("Employee not found.");

  if (existing.status === "inactive" || existing.deletedAt) {
    return badRequest("Employee is already inactive.");
  }

  // Block deactivation while there are pending leave requests
  const pendingLeaveCount = await db.leaveRequest.count({
    where: { employeeId: id, status: "pending" },
  });
  if (pendingLeaveCount > 0) {
    return badRequest(
      `Cannot deactivate an employee with ${pendingLeaveCount} pending leave request(s). Resolve them first.`,
      { pendingLeaveCount },
    );
  }

  // Safety valve: prevent deactivating an employee who is the head of a
  // department (the FK on Department.headEmployeeId is SetNull, which would
  // silently orphan the link — surface it explicitly instead).
  const departmentsHeaded = await db.department.count({
    where: { headEmployeeId: id, ...notDeleted() },
  });
  if (departmentsHeaded > 0) {
    return badRequest(
      "Cannot deactivate an employee who still heads a department. Reassign the department head first.",
      { departmentsHeaded },
    );
  }

  const updated = await db.employee.update({
    where: { id },
    data: {
      status: "inactive",
      deletedAt: new Date(),
      endDate: existing.endDate ?? new Date(),
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "delete",
    module: "staff",
    recordId: updated.id,
    recordType: "Employee",
    description: `Deactivated employee "${updated.fullName}" (${updated.employeeId})${
      parsed.data.reason ? ` — reason: ${parsed.data.reason}` : ""
    }`,
    previousValue: existing,
    newValue: updated,
  });

  return ok({ id: updated.id, deactivated: true, status: updated.status });
}
