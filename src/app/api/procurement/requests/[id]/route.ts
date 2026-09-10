// ============================================================================
// LBMS Phase 7 API — Procurement Request single-record
// ----------------------------------------------------------------------------
// GET   /api/procurement/requests/[id]   fetch one request with all relations.
//   Requires `procurement:view`.
// PATCH /api/procurement/requests/[id]   edit a DRAFT request. Editing is
//   blocked once the request is submitted (must use lifecycle endpoints).
//   requestNumber is immutable. Validates FKs the same as create. Requires
//   `procurement:edit`. Audit with previousValue + newValue.
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
import {
  PROCUREMENT_PRIORITIES,
  REQUEST_TERMINAL_STATUSES,
} from "@/lib/procurement-utils";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const PatchRequestSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  requesterId: z.string().min(1).optional(),
  projectId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  priority: z.enum(PROCUREMENT_PRIORITIES).optional(),
  requiredByDate: dateString.nullable().optional(),
  notes: z.string().max(5000).optional(),
});

const PROJECT_TERMINAL = new Set(["completed", "cancelled"]);
const TASK_TERMINAL = new Set(["completed", "cancelled"]);

// ---------------------------------------------------------------------------
// GET /api/procurement/requests/[id]
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("procurement", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const request = await db.procurementRequest.findFirst({
    where: { id, ...notDeleted() },
    include: {
      requester: {
        select: { id: true, fullName: true, employeeNumber: true, employeeId: true },
      },
      project: { select: { id: true, projectNumber: true, name: true, status: true } },
      task: { select: { id: true, taskNumber: true, title: true, status: true } },
      supplier: {
        select: { id: true, supplierNumber: true, tradingName: true, legalName: true, status: true },
      },
      approvedBy: { select: { id: true, username: true } },
      createdBy: { select: { id: true, username: true } },
      convertedPurchaseOrder: {
        select: { id: true, purchaseOrderNumber: true, status: true, total: true },
      },
    },
  });
  if (!request) return notFound("Procurement request not found.");

  return ok(request);
}

// ---------------------------------------------------------------------------
// PATCH /api/procurement/requests/[id]
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("procurement", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.procurementRequest.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Procurement request not found.");

  // Block edits on terminal-state requests
  if (REQUEST_TERMINAL_STATUSES.has(existing.status) || existing.status === "submitted") {
    return badRequest(
      `Cannot edit a ${existing.status} request. Only draft requests may be edited.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = PatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // --- Validate requester ---
  if (d.requesterId && d.requesterId !== existing.requesterId) {
    const r = await db.employee.findFirst({
      where: { id: d.requesterId, ...notDeleted() },
      select: { id: true },
    });
    if (!r) return badRequest("Selected requester does not exist or is inactive.");
  }

  // --- Validate projectId ---
  if (d.projectId !== undefined && d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true, status: true },
    });
    if (!project) return badRequest("Selected project does not exist or is archived.");
    if (PROJECT_TERMINAL.has(project.status)) {
      return badRequest(`Cannot link a procurement request against a ${project.status} project.`);
    }
  }

  // --- Validate taskId ---
  if (d.taskId !== undefined && d.taskId) {
    const task = await db.task.findFirst({
      where: { id: d.taskId, ...notDeleted() },
      select: { id: true, status: true, projectId: true },
    });
    if (!task) return badRequest("Selected task does not exist or is deleted.");
    if (TASK_TERMINAL.has(task.status)) {
      return badRequest(`Cannot link a procurement request against a ${task.status} task.`);
    }
    const effectiveProjectId = d.projectId !== undefined ? d.projectId : existing.projectId;
    if (effectiveProjectId && task.projectId && task.projectId !== effectiveProjectId) {
      return badRequest("Task/project mismatch: the selected task belongs to a different project.");
    }
  }

  // --- Validate supplierId ---
  if (d.supplierId !== undefined && d.supplierId) {
    const supplier = await db.supplier.findFirst({
      where: { id: d.supplierId, ...notDeleted() },
      select: { id: true, status: true },
    });
    if (!supplier) return badRequest("Selected supplier does not exist or is archived.");
    if (supplier.status === "archived") return badRequest("Selected supplier is archived.");
  }

  const data: Record<string, unknown> = { updatedById: auth.ctx.userId };
  if (d.title !== undefined) data.title = d.title.trim();
  if (d.description !== undefined) data.description = d.description?.trim() || null;
  if (d.requesterId !== undefined) data.requesterId = d.requesterId;
  if (d.projectId !== undefined) data.projectId = d.projectId || null;
  if (d.taskId !== undefined) data.taskId = d.taskId || null;
  if (d.supplierId !== undefined) data.supplierId = d.supplierId || null;
  if (d.priority !== undefined) data.priority = d.priority;
  if (d.requiredByDate !== undefined) data.requiredByDate = d.requiredByDate ? new Date(d.requiredByDate) : null;
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;

  const updated = await db.procurementRequest.update({
    where: { id },
    data,
    include: {
      requester: { select: { id: true, fullName: true, employeeNumber: true } },
      project: { select: { id: true, projectNumber: true, name: true } },
      task: { select: { id: true, taskNumber: true, title: true } },
      supplier: { select: { id: true, supplierNumber: true, tradingName: true, legalName: true } },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "procurement",
    recordId: updated.id,
    recordType: "ProcurementRequest",
    description: `Updated procurement request ${updated.requestNumber}`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
