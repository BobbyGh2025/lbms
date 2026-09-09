// ============================================================================
// LBMS CRM API — Activities collection
// ----------------------------------------------------------------------------
// GET  /api/activities   paginated list with filters (customerId, supplierId,
//                        assignedToId, status, activityType, dueDate range
//                        via dueFrom/dueTo). activities:view.
// POST /api/activities   create activity. Validates that at most one of
//                        customerId/supplierId is set (an activity is linked
//                        to a single party, or neither for a general
//                        activity). Validates customer/supplier/employee FKs.
//                        Sets status="open", createdById=ctx.userId.
//                        activities:create. Audit recorded.
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

// ---------------------------------------------------------------------------
// Constants — shared across activity routes
// ---------------------------------------------------------------------------
export const ACTIVITY_TYPES = [
  "call",
  "meeting",
  "email",
  "follow_up",
  "site_visit",
  "note",
  "quotation",
  "other",
] as const;

export const ACTIVITY_STATUSES = [
  "open",
  "completed",
  "cancelled",
  "overdue",
] as const;

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/activities
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("activities", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const customerId = sp.get("customerId")?.trim() || undefined;
  const supplierId = sp.get("supplierId")?.trim() || undefined;
  const assignedToId = sp.get("assignedToId")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const activityType = sp.get("activityType")?.trim() || undefined;
  const dueFrom = sp.get("dueFrom");
  const dueTo = sp.get("dueTo");
  const search = sp.get("search")?.trim() || undefined;

  const where: Record<string, unknown> = {};
  if (customerId) where.customerId = customerId;
  if (supplierId) where.supplierId = supplierId;
  if (assignedToId) where.assignedToId = assignedToId;
  if (status) where.status = status;
  if (activityType) where.activityType = activityType;
  if (dueFrom || dueTo) {
    where.dueDate = {
      ...(dueFrom ? { gte: new Date(dueFrom) } : {}),
      ...(dueTo ? { lte: new Date(dueTo) } : {}),
    };
  }
  if (search) {
    where.OR = [
      { subject: { contains: search } },
      { description: { contains: search } },
    ];
  }

  const [total, items] = await Promise.all([
    db.activity.count({ where }),
    db.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        customer: {
          select: {
            id: true,
            customerNumber: true,
            tradingName: true,
            legalName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            supplierNumber: true,
            tradingName: true,
            legalName: true,
          },
        },
        assignedTo: {
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
// POST /api/activities
// ---------------------------------------------------------------------------
const CreateActivitySchema = z.object({
  activityType: z.enum(ACTIVITY_TYPES),
  subject: z.string().min(1, "Subject is required").max(200),
  description: z.string().max(5000).optional(),
  customerId: z.string().optional(),
  supplierId: z.string().optional(),
  assignedToId: z.string().optional(),
  dueDate: dateString.optional(),
  status: z.enum(ACTIVITY_STATUSES).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("activities", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateActivitySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Validation: an activity is linked to AT MOST one party. Either
  // customerId XOR supplierId, or neither for a general activity. Both
  // being set is rejected to avoid ambiguous linkage.
  if (d.customerId && d.supplierId) {
    return badRequest(
      "An activity may be linked to a customer OR a supplier, but not both. Leave both blank for a general activity.",
    );
  }

  // Validate customer FK (when provided)
  if (d.customerId) {
    const customer = await db.customer.findFirst({
      where: { id: d.customerId, ...notDeleted() },
      select: { id: true, customerNumber: true },
    });
    if (!customer) return badRequest("Selected customer does not exist or is archived.");
  }

  // Validate supplier FK (when provided)
  if (d.supplierId) {
    const supplier = await db.supplier.findFirst({
      where: { id: d.supplierId, ...notDeleted() },
      select: { id: true, supplierNumber: true },
    });
    if (!supplier) return badRequest("Selected supplier does not exist or is archived.");
  }

  // Validate assignedTo (Employee FK) when provided
  if (d.assignedToId) {
    const assignee = await db.employee.findFirst({
      where: { id: d.assignedToId, ...notDeleted() },
      select: { id: true, fullName: true },
    });
    if (!assignee) {
      return badRequest("Selected assignee does not exist or is inactive.");
    }
  }

  // If status="completed" is supplied at creation time, also stamp completedDate
  const status = d.status ?? "open";
  const completedDate =
    status === "completed" ? new Date() : null;

  const created = await db.activity.create({
    data: {
      activityType: d.activityType,
      subject: d.subject.trim(),
      description: d.description?.trim() || null,
      customerId: d.customerId || null,
      supplierId: d.supplierId || null,
      assignedToId: d.assignedToId || null,
      dueDate: d.dueDate ? new Date(d.dueDate) : null,
      completedDate,
      status,
      createdById: auth.ctx.userId,
    },
    include: {
      customer: {
        select: {
          id: true,
          customerNumber: true,
          tradingName: true,
          legalName: true,
        },
      },
      supplier: {
        select: {
          id: true,
          supplierNumber: true,
          tradingName: true,
          legalName: true,
        },
      },
      assignedTo: {
        select: {
          id: true,
          fullName: true,
          employeeNumber: true,
        },
      },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "create",
    module: "activities",
    recordId: created.id,
    recordType: "Activity",
    description: `Created activity "${created.subject}" (${created.activityType})${
      created.customer
        ? ` → customer ${created.customer.customerNumber}`
        : created.supplier
          ? ` → supplier ${created.supplier.supplierNumber}`
          : " (general)"
    }`,
    newValue: created,
  });

  return ok(created, 201);
}
