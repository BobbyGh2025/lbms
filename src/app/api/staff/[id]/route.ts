// ============================================================================
// LBMS Staff API — Employee detail
// ----------------------------------------------------------------------------
// GET   /api/staff/[id]   single employee with department, position, manager,
//                         direct reports count, emergency contacts, and recent
//                         leave requests. staff:view.
// PATCH /api/staff/[id]   update employee fields. employeeId is immutable.
//                         managerId is validated for self-reference + circular
//                         chain. staff:edit. Audit records previousValue +
//                         newValue.
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
import { hasPermission } from "@/lib/permissions";
import { wouldCreateCircularManager } from "@/lib/staff-utils";
import { EMPLOYMENT_TYPES, EMPLOYEE_STATUSES } from "@/app/api/staff/route";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/staff/[id]
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("staff", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const viewSensitive = await hasPermission("staff", "view_sensitive");

  const employee = await db.employee.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true,
      employeeId: true,
      employeeNumber: true,
      fullName: true,
      firstName: true,
      middleName: true,
      lastName: true,
      preferredName: true,
      profilePhotoUrl: true,
      email: true,
      phone: true,
      city: true,
      workLocation: true,
      employmentType: true,
      status: true,
      employmentDate: true,
      confirmationDate: true,
      endDate: true,
      departmentId: true,
      positionId: true,
      managerId: true,
      createdAt: true,
      updatedAt: true,
      ...(viewSensitive
        ? {
            gender: true,
            dateOfBirth: true,
            alternativePhone: true,
            address: true,
            notes: true,
          }
        : {}),
      department: { select: { id: true, name: true, code: true } },
      position: { select: { id: true, title: true, responsibilities: true } },
      manager: {
        select: {
          id: true,
          fullName: true,
          employeeId: true,
          employeeNumber: true,
        },
      },
      emergencyContacts: true,
      leaveRequests: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          reference: true,
          startDate: true,
          endDate: true,
          status: true,
          leaveType: { select: { id: true, name: true, code: true } },
          createdAt: true,
        },
      },
      _count: {
        select: {
          directReports: { where: { deletedAt: null } },
          departmentsHeaded: { where: { deletedAt: null } },
        },
      },
    },
  });

  if (!employee) return notFound("Employee not found.");

  return ok(employee);
}

// ---------------------------------------------------------------------------
// PATCH /api/staff/[id]
// ---------------------------------------------------------------------------
const UpdateEmployeeSchema = z.object({
  // employeeId is intentionally omitted — it is immutable.
  firstName: z.string().max(100).optional(),
  middleName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  fullName: z.string().max(200).optional(),
  preferredName: z.string().max(100).optional(),
  email: z.string().email("Invalid email format").optional().or(z.literal("")),
  phone: z.string().max(50).optional(),
  alternativePhone: z.string().max(50).optional(),
  dateOfBirth: dateString.optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  profilePhotoUrl: z.string().url().optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  workLocation: z.string().max(100).optional(),
  departmentId: z.string().nullable().optional(),
  positionId: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  employmentDate: dateString.nullable().optional(),
  confirmationDate: dateString.nullable().optional(),
  endDate: dateString.nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable().optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("staff", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = UpdateEmployeeSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Block any attempt to change employeeId (immutable per spec)
  if (typeof (body as Record<string, unknown>)?.employeeId !== "undefined") {
    return badRequest("Employee ID is immutable and cannot be changed.");
  }

  const existing = await db.employee.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Employee not found.");

  // Build the update payload — only fields explicitly present in the body
  // are written. Empty strings are normalised to null where appropriate.
  const data: Record<string, unknown> = {};

  const stringFields: Array<keyof typeof d> = [
    "firstName",
    "middleName",
    "lastName",
    "fullName",
    "preferredName",
    "phone",
    "alternativePhone",
    "profilePhotoUrl",
    "address",
    "city",
    "workLocation",
    "notes",
    "employmentType",
    "status",
    "gender",
  ];

  for (const f of stringFields) {
    const v = d[f];
    if (v === undefined) continue;
    if (v === null) {
      data[f] = null;
    } else if (typeof v === "string") {
      // For most text fields, empty string collapses to null; status/employmentType
      // are enums so they are never empty by zod.
      if (
        f === "firstName" ||
        f === "middleName" ||
        f === "lastName" ||
        f === "preferredName" ||
        f === "phone" ||
        f === "alternativePhone" ||
        f === "profilePhotoUrl" ||
        f === "address" ||
        f === "city" ||
        f === "workLocation" ||
        f === "notes"
      ) {
        data[f] = v.trim() || null;
      } else {
        data[f] = v;
      }
    } else {
      data[f] = v;
    }
  }

  // email (special: unique constraint + lowercase + empty → null)
  if (d.email !== undefined) {
    const trimmed = typeof d.email === "string" ? d.email.trim().toLowerCase() : "";
    data.email = trimmed || null;
  }

  // dateOfBirth / employmentDate / confirmationDate / endDate
  if (d.dateOfBirth !== undefined) {
    data.dateOfBirth = d.dateOfBirth ? new Date(d.dateOfBirth) : null;
  }
  if (d.employmentDate !== undefined) {
    data.employmentDate = d.employmentDate ? new Date(d.employmentDate) : null;
  }
  if (d.confirmationDate !== undefined) {
    data.confirmationDate = d.confirmationDate ? new Date(d.confirmationDate) : null;
  }
  if (d.endDate !== undefined) {
    data.endDate = d.endDate ? new Date(d.endDate) : null;
  }

  // departmentId / positionId / managerId (nullable)
  if (d.departmentId !== undefined) data.departmentId = d.departmentId || null;
  if (d.positionId !== undefined) data.positionId = d.positionId || null;
  if (d.managerId !== undefined) data.managerId = d.managerId || null;

  // ───────────────────────────────────────────────────────────────────────
  // Validation of referenced entities
  // ───────────────────────────────────────────────────────────────────────

  // email uniqueness (when changing)
  if (data.email !== undefined && data.email !== null && data.email !== existing.email) {
    const dup = await db.employee.findFirst({
      where: { email: data.email as string, NOT: { id } },
      select: { id: true },
    });
    if (dup) return badRequest("An employee with this email already exists.");
  }

  // department
  if (data.departmentId !== undefined && data.departmentId !== null) {
    const dept = await db.department.findFirst({
      where: { id: data.departmentId as string, ...notDeleted() },
      select: { id: true },
    });
    if (!dept) return badRequest("Selected department does not exist or is inactive.");
  }

  // position
  if (data.positionId !== undefined && data.positionId !== null) {
    const pos = await db.position.findFirst({
      where: { id: data.positionId as string, ...notDeleted() },
      select: { id: true },
    });
    if (!pos) return badRequest("Selected position does not exist or is inactive.");
  }

  // manager — self-reference + circular chain check
  if (data.managerId !== undefined && data.managerId !== null) {
    const newManagerId = data.managerId as string;
    if (newManagerId === id) {
      return badRequest("An employee cannot be their own manager.");
    }
    const mgr = await db.employee.findFirst({
      where: { id: newManagerId, ...notDeleted() },
      select: { id: true, fullName: true, status: true },
    });
    if (!mgr) return badRequest("Selected manager does not exist or is inactive.");

    // Walk the chain — would assigning this manager create a cycle?
    const circular = await wouldCreateCircularManager(id, newManagerId);
    if (circular) {
      return badRequest(
        "Cannot assign this manager — it would create a circular reporting line.",
      );
    }
  }

  if (Object.keys(data).length === 0) {
    return badRequest("No fields provided to update.");
  }

  // Stamp updatedById for audit trail
  data.updatedById = auth.ctx.userId;
  data.updatedAt = new Date();

  const updated = await db.employee.update({
    where: { id },
    data,
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "staff",
    recordId: updated.id,
    recordType: "Employee",
    description: `Updated employee "${updated.fullName}" (${updated.employeeId})`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
