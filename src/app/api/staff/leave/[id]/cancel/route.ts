// ============================================================================
// LBMS Staff API — Cancel leave request
// ----------------------------------------------------------------------------
// POST /api/staff/leave/[id]/cancel   cancel a pending leave request.
//   - Only "pending" requests can be cancelled.
//   - Caller must be the original requester (requestedById === ctx.userId)
//     OR hold the leave:manage permission.
//   - leave:create (own) OR leave:manage.
//   - On success: status="cancelled". Audit recorded.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
  badRequest,
  notFound,
  forbidden,
  auditFromCtx,
} from "@/lib/api-helpers";
import { hasPermission } from "@/lib/permissions";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const CancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  // Allow either leave:create (own requests) OR leave:manage (any request).
  // We check both; the more specific own-request authorisation is applied
  // below when the requester doesn't have manage.
  let auth = await authorize("leave", "create");
  if (!auth.ok) {
    const manage = await authorize("leave", "manage");
    if (!manage.ok) {
      return auth.response;
    }
    auth = manage;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = CancelSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }

  const existing = await db.leaveRequest.findUnique({
    where: { id },
    include: {
      employee: {
        select: { id: true, fullName: true, employeeId: true },
      },
      leaveType: { select: { id: true, name: true } },
    },
  });

  if (!existing) return notFound("Leave request not found.");

  if (existing.status !== "pending") {
    return badRequest(
      `Cannot cancel a leave request that is already "${existing.status}". Only pending requests can be cancelled.`,
    );
  }

  // Authorization refinement: if the caller used leave:create (not manage),
  // they may only cancel their OWN requests.
  const isManager = await hasPermission("leave", "manage");
  if (!isManager && existing.requestedById !== auth.ctx.userId) {
    return forbidden("You can only cancel your own pending leave requests.");
  }

  const updated = await db.leaveRequest.update({
    where: { id },
    data: {
      status: "cancelled",
    },
    include: {
      employee: {
        select: { id: true, fullName: true, employeeId: true },
      },
      leaveType: { select: { id: true, name: true } },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "leave",
    recordId: updated.id,
    recordType: "LeaveRequest",
    description: `Cancelled leave request ${updated.reference} for ${updated.employee.fullName} (${updated.employee.employeeId})${
      parsed.data.reason ? ` — reason: ${parsed.data.reason.trim()}` : ""
    }`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
