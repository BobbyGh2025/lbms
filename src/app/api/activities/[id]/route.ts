// ============================================================================
// LBMS CRM API — Activity detail
// ----------------------------------------------------------------------------
// GET   /api/activities/[id]   single activity with customer, supplier,
//                              assignedTo, createdBy relations. activities:view.
// PATCH /api/activities/[id]   update activity fields. Validates customer /
//                              supplier / employee FKs and the XOR rule
//                              (cannot be linked to both). activities:edit.
//                              Audit records previousValue + newValue.
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
import { ACTIVITY_TYPES, ACTIVITY_STATUSES } from "@/app/api/activities/route";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/activities/[id]
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("activities", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const activity = await db.activity.findUnique({
    where: { id },
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
  });

  if (!activity) return notFound("Activity not found.");

  return ok(activity);
}

// ---------------------------------------------------------------------------
// PATCH /api/activities/[id]
// ---------------------------------------------------------------------------
const UpdateActivitySchema = z.object({
  activityType: z.enum(ACTIVITY_TYPES).optional(),
  subject: z.string().min(1, "Subject cannot be empty").max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  customerId: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  assignedToId: z.string().nullable().optional(),
  dueDate: dateString.nullable().optional(),
  status: z.enum(ACTIVITY_STATUSES).optional(),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("activities", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = UpdateActivitySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  const existing = await db.activity.findUnique({
    where: { id },
  });
  if (!existing) return notFound("Activity not found.");

  // Resolve the effective party linkage to enforce the XOR rule.
  const effectiveCustomerId =
    d.customerId !== undefined ? d.customerId : existing.customerId;
  const effectiveSupplierId =
    d.supplierId !== undefined ? d.supplierId : existing.supplierId;
  if (effectiveCustomerId && effectiveSupplierId) {
    return badRequest(
      "An activity may be linked to a customer OR a supplier, but not both. Leave both blank for a general activity.",
    );
  }

  // Validate referenced entities (only when explicitly provided)
  if (d.customerId !== undefined && d.customerId !== null) {
    const customer = await db.customer.findFirst({
      where: { id: d.customerId, ...notDeleted() },
      select: { id: true, customerNumber: true },
    });
    if (!customer) return badRequest("Selected customer does not exist or is archived.");
  }
  if (d.supplierId !== undefined && d.supplierId !== null) {
    const supplier = await db.supplier.findFirst({
      where: { id: d.supplierId, ...notDeleted() },
      select: { id: true, supplierNumber: true },
    });
    if (!supplier) return badRequest("Selected supplier does not exist or is archived.");
  }
  if (d.assignedToId !== undefined && d.assignedToId !== null) {
    const assignee = await db.employee.findFirst({
      where: { id: d.assignedToId, ...notDeleted() },
      select: { id: true, fullName: true },
    });
    if (!assignee) {
      return badRequest("Selected assignee does not exist or is inactive.");
    }
  }

  const data: Record<string, unknown> = {};

  if (d.activityType !== undefined) data.activityType = d.activityType;
  if (d.subject !== undefined) data.subject = d.subject.trim();
  if (d.description !== undefined)
    data.description = d.description?.trim() || null;
  if (d.customerId !== undefined) data.customerId = d.customerId || null;
  if (d.supplierId !== undefined) data.supplierId = d.supplierId || null;
  if (d.assignedToId !== undefined) data.assignedToId = d.assignedToId || null;
  if (d.dueDate !== undefined) {
    data.dueDate = d.dueDate ? new Date(d.dueDate) : null;
  }

  // Status handling:
  // - When transitioning to "completed" via PATCH, stamp completedDate=now
  //   (unless the caller already supplied a value; we don't expose it on
  //   this route — they should use /complete for the canonical flow).
  // - When transitioning away from "completed", clear completedDate.
  if (d.status !== undefined) {
    data.status = d.status;
    if (d.status === "completed" && existing.status !== "completed") {
      data.completedDate = new Date();
    } else if (d.status !== "completed" && existing.status === "completed") {
      data.completedDate = null;
    }
  }

  if (Object.keys(data).length === 0) {
    return badRequest("No fields provided to update.");
  }

  const updated = await db.activity.update({
    where: { id },
    data,
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
    action: "update",
    module: "activities",
    recordId: updated.id,
    recordType: "Activity",
    description: `Updated activity "${updated.subject}" (${updated.activityType})`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
