// ============================================================================
// LBMS Staff API — Reject leave request
// ----------------------------------------------------------------------------
// POST /api/staff/leave/[id]/reject   reject a pending leave request.
//   - Body: { reason } — required, min 3 chars.
//   - Only "pending" can be rejected.
//   - leave:reject permission required.
//   - On success: status="rejected", rejectionReason=reason. Audit +
//     notification to the requesting employee.
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

const RejectSchema = z.object({
  reason: z
    .string()
    .min(3, "A rejection reason (min 3 chars) is required.")
    .max(1000, "Rejection reason is too long (max 1000 chars)."),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("leave", "reject");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }
  const parsed = RejectSchema.safeParse(body);
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
      `Cannot reject a leave request that is already "${existing.status}". Only pending requests can be rejected.`,
    );
  }

  const updated = await db.leaveRequest.update({
    where: { id },
    data: {
      status: "rejected",
      rejectionReason: parsed.data.reason.trim(),
    },
    include: {
      employee: {
        select: { id: true, fullName: true, employeeId: true },
      },
      leaveType: { select: { id: true, name: true } },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "reject",
    module: "leave",
    recordId: updated.id,
    recordType: "LeaveRequest",
    description: `Rejected leave request ${updated.reference} for ${updated.employee.fullName} (${updated.employee.employeeId}) — reason: ${parsed.data.reason.trim()}`,
    previousValue: existing,
    newValue: updated,
  });

  // Notify the requesting employee
  await notifyEmployeeUser({
    employeeId: existing.employeeId,
    title: "Leave request rejected",
    message: `Your ${existing.leaveType.name} leave (${updated.reference}) was rejected. Reason: ${parsed.data.reason.trim()}`,
    type: "warning",
    category: "approval",
    linkUrl: `/staff/leave/${updated.id}`,
  });

  return ok(updated);
}
