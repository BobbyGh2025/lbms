// ============================================================================
// LBMS Staff API — Approve leave request
// ----------------------------------------------------------------------------
// POST /api/staff/leave/[id]/approve   approve a pending leave request.
//   - Only "pending" can be approved.
//   - Self-approval is blocked: requestedById cannot equal the approver's
//     user ID.
//   - leave:approve permission required.
//   - On success: status="approved", approvedById=ctx.userId,
//     approvedAt=now. Audit + notification to the requesting employee.
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
} from "@/lib/api-helpers";
import { notifyEmployeeUser } from "@/lib/staff-utils";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ApproveSchema = z.object({
  notes: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("leave", "approve");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = ApproveSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }

  const existing = await db.leaveRequest.findUnique({
    where: { id },
    include: {
      employee: {
        select: { id: true, fullName: true, employeeId: true, user: { select: { id: true } } },
      },
      leaveType: { select: { id: true, name: true } },
    },
  });

  if (!existing) return notFound("Leave request not found.");

  if (existing.status !== "pending") {
    return badRequest(
      `Cannot approve a leave request that is already "${existing.status}". Only pending requests can be approved.`,
    );
  }

  // Prevent self-approval
  if (existing.requestedById === auth.ctx.userId) {
    return badRequest("You cannot approve your own leave request.");
  }

  const updated = await db.leaveRequest.update({
    where: { id },
    data: {
      status: "approved",
      approvedById: auth.ctx.userId,
      approvedAt: new Date(),
    },
    include: {
      employee: {
        select: { id: true, fullName: true, employeeId: true },
      },
      leaveType: { select: { id: true, name: true } },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "approve",
    module: "leave",
    recordId: updated.id,
    recordType: "LeaveRequest",
    description: `Approved leave request ${updated.reference} for ${updated.employee.fullName} (${updated.employee.employeeId})`,
    previousValue: existing,
    newValue: updated,
  });

  // Notify the requesting employee (if they have a user account)
  await notifyEmployeeUser({
    employeeId: existing.employeeId,
    title: "Leave request approved",
    message: `Your ${existing.leaveType.name} leave (${updated.reference}, ${updated.startDate.toISOString().slice(0, 10)} → ${updated.endDate.toISOString().slice(0, 10)}) has been approved.`,
    type: "success",
    category: "approval",
    linkUrl: `/staff/leave/${updated.id}`,
  });

  return ok(updated);
}
