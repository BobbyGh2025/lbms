// ============================================================================
// LBMS Staff API — Leave requests collection
// ----------------------------------------------------------------------------
// GET  /api/staff/leave   paginated list with filters (employeeId, status,
//                         leaveTypeId, date range). leave:view.
// POST /api/staff/leave   create a leave request. Auto-generates reference
//                         LEV-YYYY-NNNNNN via EmployeeRefCounter (prefix
//                         "LEV"). Validates: valid employee, valid leave
//                         type, startDate <= endDate, no overlap with
//                         existing approved leave for same employee. Sets
//                         status="pending", requestedById=ctx.userId. leave:create.
//                         Audit + notification to manager (if any).
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
  badRequest,
  auditFromCtx,
  notDeleted,
} from "@/lib/api-helpers";
import { nextReferenceNumber, notifyEmployeeUser, notifyUser } from "@/lib/staff-utils";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/staff/leave
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("leave", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const employeeId = sp.get("employeeId")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const leaveTypeId = sp.get("leaveTypeId")?.trim() || undefined;
  const from = sp.get("from");
  const to = sp.get("to");

  const where: Record<string, unknown> = {};
  if (employeeId) where.employeeId = employeeId;
  if (status) where.status = status;
  if (leaveTypeId) where.leaveTypeId = leaveTypeId;
  if (from || to) {
    where.startDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const [total, items] = await Promise.all([
    db.leaveRequest.count({ where }),
    db.leaveRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            employeeNumber: true,
            managerId: true,
            manager: {
              select: { id: true, fullName: true, user: { select: { id: true } } },
            },
          },
        },
        leaveType: { select: { id: true, name: true, code: true, isPaid: true } },
        requestedBy: { select: { id: true, username: true } },
        approvedBy: { select: { id: true, username: true } },
      },
    }),
  ]);

  return ok({
    items,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

// ---------------------------------------------------------------------------
// POST /api/staff/leave
// ---------------------------------------------------------------------------
const CreateLeaveSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  leaveTypeId: z.string().min(1, "Leave type ID is required"),
  startDate: dateString,
  endDate: dateString,
  reason: z.string().max(2000).optional(),
  attachmentUrl: z.string().url().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("leave", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateLeaveSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  const start = new Date(d.startDate);
  const end = new Date(d.endDate);
  if (start > end) {
    return badRequest("Start date must be on or before end date.");
  }

  // Validate employee (active, not deleted)
  const employee = await db.employee.findFirst({
    where: { id: d.employeeId, ...notDeleted() },
    select: {
      id: true,
      fullName: true,
      employeeId: true,
      managerId: true,
      manager: {
        select: { id: true, fullName: true, user: { select: { id: true } } },
      },
    },
  });
  if (!employee) return badRequest("Selected employee does not exist or is inactive.");

  // Validate leave type
  const leaveType = await db.leaveType.findFirst({
    where: { id: d.leaveTypeId, status: "active" },
    select: { id: true, name: true, code: true },
  });
  if (!leaveType) return badRequest("Selected leave type does not exist or is inactive.");

  // Overlap check: no overlap with existing approved leave for same employee
  const overlap = await db.leaveRequest.findFirst({
    where: {
      employeeId: d.employeeId,
      status: "approved",
      // two ranges [a,b] and [c,d] overlap when a <= d && c <= b
      startDate: { lte: end },
      endDate: { gte: start },
    },
    select: { id: true, reference: true, startDate: true, endDate: true },
  });
  if (overlap) {
    return badRequest(
      `This leave overlaps with an existing approved leave (${overlap.reference}, ${overlap.startDate.toISOString().slice(0, 10)} → ${overlap.endDate.toISOString().slice(0, 10)}).`,
      { overlappingRequest: overlap },
    );
  }

  const year = new Date().getFullYear();

  try {
    const created = await db.$transaction(async (tx) => {
      const reference = await nextReferenceNumber(tx, "LEV", year);

      return tx.leaveRequest.create({
        data: {
          reference,
          employeeId: d.employeeId,
          leaveTypeId: d.leaveTypeId,
          startDate: start,
          endDate: end,
          reason: d.reason?.trim() || null,
          attachmentUrl: d.attachmentUrl ?? null,
          status: "pending",
          requestedById: auth.ctx.userId,
        },
        include: {
          employee: { select: { id: true, fullName: true, employeeId: true } },
          leaveType: { select: { id: true, name: true, code: true } },
        },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "leave",
      recordId: created.id,
      recordType: "LeaveRequest",
      description: `Created leave request ${created.reference} for ${created.employee.fullName} (${created.employee.employeeId}) — ${created.leaveType.name}`,
      newValue: created,
    });

    // Notify the employee's manager (if any) of the new pending request
    if (employee.manager?.user?.id) {
      await notifyUser({
        userId: employee.manager.user.id,
        title: "New leave request for approval",
        message: `${created.employee.fullName} requested ${created.leaveType.name} leave (${created.reference}).`,
        type: "info",
        category: "approval",
        linkUrl: `/staff/leave/${created.id}`,
      });
    }

    return ok(created, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest(
        "A race condition occurred while generating the leave reference. Please retry.",
      );
    }
    throw err;
  }
}
