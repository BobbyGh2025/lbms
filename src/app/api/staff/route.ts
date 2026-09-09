// ============================================================================
// LBMS Staff API — Employee collection
// ----------------------------------------------------------------------------
// GET  /api/staff   paginated, searchable, filterable list of employees
//                   (staff:view). Sensitive HR fields (dateOfBirth, address,
//                   alternativePhone, gender, notes) are only included when
//                   the caller also holds staff:view_sensitive.
// POST /api/staff   create a new employee record. Auto-generates
//                   `employeeNumber` as EMP-YYYY-NNNNNN via the
//                   EmployeeRefCounter concurrency-safe counter, inside a
//                   single db.$transaction. Validates unique email + unique
//                   employeeId, valid department / position / manager refs,
//                   and prevents manager circular references. Staff:create.
//                   Audit recorded.
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
import { hasPermission } from "@/lib/permissions";
import { nextEmployeeNumber, wouldCreateCircularManager } from "@/lib/staff-utils";

// ---------------------------------------------------------------------------
// Constants — shared across staff routes
// ---------------------------------------------------------------------------
export const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "temporary",
  "intern",
  "consultant",
] as const;

export const EMPLOYEE_STATUSES = [
  "active",
  "probation",
  "on_leave",
  "suspended",
  "resigned",
  "terminated",
  "retired",
  "inactive",
] as const;

const SORTABLE_FIELDS = [
  "fullName",
  "email",
  "createdAt",
  "updatedAt",
  "employmentDate",
  "status",
  "employeeId",
  "employeeNumber",
] as const;

// Date string validator — accepts ISO 8601 (with or without TZ) or YYYY-MM-DD.
const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/staff
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("staff", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const departmentId = sp.get("departmentId")?.trim() || undefined;
  const employmentType = sp.get("employmentType")?.trim() || undefined;
  const managerId = sp.get("managerId")?.trim() || undefined;

  const sortByParam = sp.get("sortBy")?.trim() || "createdAt";
  const sortDir = sp.get("sortDir")?.trim().toLowerCase() === "asc" ? "asc" : "desc";
  const sortBy = (SORTABLE_FIELDS as readonly string[]).includes(sortByParam)
    ? sortByParam
    : "createdAt";

  // Sensitive HR fields are gated behind an additional permission.
  const viewSensitive = await hasPermission("staff", "view_sensitive");

  const where: Record<string, unknown> = {
    ...notDeleted(),
    ...(search
      ? {
          OR: [
            { employeeId: { contains: search } },
            { employeeNumber: { contains: search } },
            { fullName: { contains: search } },
            { firstName: { contains: search } },
            { lastName: { contains: search } },
            { email: { contains: search } },
            { phone: { contains: search } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(employmentType ? { employmentType } : {}),
    ...(managerId ? { managerId } : {}),
  };

  const [total, items] = await Promise.all([
    db.employee.count({ where }),
    db.employee.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip,
      take: pageSize,
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
        // Sensitive fields only when caller has staff:view_sensitive
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
        position: { select: { id: true, title: true } },
        manager: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            employeeNumber: true,
          },
        },
      },
    }),
  ]);

  return ok({
    items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/staff
// ---------------------------------------------------------------------------
const EmergencyContactSchema = z.object({
  name: z.string().min(1, "Emergency contact name is required"),
  relationship: z.string().optional(),
  phone: z.string().min(1, "Emergency contact phone is required"),
  alternativePhone: z.string().optional(),
  address: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

const CreateEmployeeSchema = z.object({
  employeeId: z
    .string()
    .min(1, "Employee ID is required")
    .max(50, "Employee ID is too long (max 50 chars)"),
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
  departmentId: z.string().optional(),
  positionId: z.string().optional(),
  managerId: z.string().optional(),
  employmentDate: dateString.optional(),
  confirmationDate: dateString.optional(),
  endDate: dateString.optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  notes: z.string().max(2000).optional(),
  emergencyContacts: z.array(EmergencyContactSchema).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("staff", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateEmployeeSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Derive fullName from firstName/lastName if not provided
  const trimmedFullName = d.fullName?.trim() || "";
  const derivedFullName = [
    d.firstName?.trim() || "",
    d.lastName?.trim() || "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const fullName = trimmedFullName || derivedFullName;
  if (!fullName) {
    return badRequest("Either fullName or firstName + lastName is required.");
  }

  // Normalise email (empty string → undefined)
  const email = d.email && d.email.trim() ? d.email.trim().toLowerCase() : undefined;

  // Unique checks
  const [existingEmployeeId, existingEmail, existingUserEmployeeId] = await Promise.all([
    db.employee.findFirst({
      where: { employeeId: d.employeeId },
      select: { id: true },
    }),
    email
      ? db.employee.findFirst({ where: { email }, select: { id: true } })
      : Promise.resolve(null),
    db.user.findFirst({
      where: { employeeId: d.employeeId },
      select: { id: true },
    }),
  ]);
  if (existingEmployeeId) {
    return badRequest("An employee with this Employee ID already exists.");
  }
  if (existingEmail) {
    return badRequest("An employee with this email already exists.");
  }
  if (existingUserEmployeeId) {
    return badRequest(
      "This Employee ID is already linked to a user account and cannot be reused.",
    );
  }

  // Validate department (when provided)
  if (d.departmentId) {
    const dept = await db.department.findFirst({
      where: { id: d.departmentId, ...notDeleted() },
      select: { id: true, name: true },
    });
    if (!dept) return badRequest("Selected department does not exist or is inactive.");
  }

  // Validate position (when provided)
  if (d.positionId) {
    const pos = await db.position.findFirst({
      where: { id: d.positionId, ...notDeleted() },
      select: { id: true, title: true },
    });
    if (!pos) return badRequest("Selected position does not exist or is inactive.");
  }

  // Validate manager (when provided)
  if (d.managerId) {
    const mgr = await db.employee.findFirst({
      where: { id: d.managerId, ...notDeleted() },
      select: { id: true, fullName: true, status: true },
    });
    if (!mgr) return badRequest("Selected manager does not exist or is inactive.");
    // Circular check is moot for a new employee (no reports yet), but we keep
    // the gate to fail loud if a self-reference ever slips through upstream.
    if (d.managerId === d.employeeId) {
      return badRequest("An employee cannot be their own manager.");
    }
  }

  const year = new Date().getFullYear();

  try {
    const created = await db.$transaction(async (tx) => {
      const employeeNumber = await nextEmployeeNumber(tx, year);

      return tx.employee.create({
        data: {
          employeeId: d.employeeId,
          employeeNumber,
          fullName,
          firstName: d.firstName?.trim() || null,
          middleName: d.middleName?.trim() || null,
          lastName: d.lastName?.trim() || null,
          preferredName: d.preferredName?.trim() || null,
          email,
          phone: d.phone?.trim() || null,
          alternativePhone: d.alternativePhone?.trim() || null,
          dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : null,
          gender: d.gender ?? null,
          profilePhotoUrl: d.profilePhotoUrl ?? null,
          address: d.address?.trim() || null,
          city: d.city?.trim() || null,
          workLocation: d.workLocation?.trim() || null,
          departmentId: d.departmentId || null,
          positionId: d.positionId || null,
          managerId: d.managerId || null,
          employmentDate: d.employmentDate ? new Date(d.employmentDate) : null,
          confirmationDate: d.confirmationDate ? new Date(d.confirmationDate) : null,
          endDate: d.endDate ? new Date(d.endDate) : null,
          employmentType: d.employmentType ?? null,
          status: d.status ?? "active",
          notes: d.notes?.trim() || null,
          createdById: auth.ctx.userId,
          updatedById: auth.ctx.userId,
          emergencyContacts: d.emergencyContacts?.length
            ? {
                create: d.emergencyContacts.map((c) => ({
                  name: c.name.trim(),
                  relationship: c.relationship?.trim() || null,
                  phone: c.phone.trim(),
                  alternativePhone: c.alternativePhone?.trim() || null,
                  address: c.address?.trim() || null,
                  isPrimary: c.isPrimary ?? false,
                })),
              }
            : undefined,
        },
        include: { emergencyContacts: true },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "staff",
      recordId: created.id,
      recordType: "Employee",
      description: `Created employee "${created.fullName}" (${created.employeeId})`,
      newValue: created,
    });

    return ok(created, 201);
  } catch (err) {
    // Surface the most common race-condition failure as a 400 instead of 500.
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest(
        "A race condition occurred while assigning the employee number or email. Please retry.",
      );
    }
    throw err;
  }
}
