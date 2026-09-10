// ============================================================================
// LBMS Phase 7 API — Procurement Request collection
// ----------------------------------------------------------------------------
// GET  /api/procurement/requests   paginated, searchable, filterable list.
//   Search matches requestNumber + title. Filters: status, priority, projectId,
//   taskId, supplierId, requesterId. Requires `procurement:view`.
// POST /api/procurement/requests   create a new procurement request (draft).
//   Auto-generates requestNumber as REQ-YYYY-NNNNNN inside a transaction.
//   Validates projectId (exists, not cancelled), taskId (exists, not cancelled,
//   belongs to same project if both set), supplierId (exists, not archived).
//   Requires `procurement:create`. Audit recorded.
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
import {
  nextProcurementRequestNumber,
  PROCUREMENT_PRIORITIES,
} from "@/lib/procurement-utils";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/procurement/requests
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("procurement", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const priority = sp.get("priority")?.trim() || undefined;
  const projectId = sp.get("projectId")?.trim() || undefined;
  const taskId = sp.get("taskId")?.trim() || undefined;
  const supplierId = sp.get("supplierId")?.trim() || undefined;
  const requesterId = sp.get("requesterId")?.trim() || undefined;

  const where: Record<string, unknown> = {
    ...notDeleted(),
    ...(search
      ? { OR: [{ requestNumber: { contains: search } }, { title: { contains: search } }] }
      : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(projectId ? { projectId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(requesterId ? { requesterId } : {}),
  };

  const [total, items] = await Promise.all([
    db.procurementRequest.count({ where }),
    db.procurementRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        requester: {
          select: { id: true, fullName: true, employeeNumber: true, employeeId: true },
        },
        project: { select: { id: true, projectNumber: true, name: true } },
        task: { select: { id: true, taskNumber: true, title: true } },
        supplier: {
          select: { id: true, supplierNumber: true, tradingName: true, legalName: true },
        },
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
// POST /api/procurement/requests
// ---------------------------------------------------------------------------
const CreateRequestSchema = z.object({
  title: z.string().min(1, "Title is required").max(300),
  description: z.string().max(5000).optional(),
  requesterId: z.string().min(1, "Requester is required"),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  supplierId: z.string().optional(),
  priority: z.enum(PROCUREMENT_PRIORITIES).optional(),
  requiredByDate: dateString.optional(),
  notes: z.string().max(5000).optional(),
});

const PROJECT_TERMINAL = new Set(["completed", "cancelled"]);
const TASK_TERMINAL = new Set(["completed", "cancelled"]);

export async function POST(req: NextRequest) {
  const auth = await authorize("procurement", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // --- Validate requester (Employee) ---
  const requester = await db.employee.findFirst({
    where: { id: d.requesterId, ...notDeleted() },
    select: { id: true, fullName: true },
  });
  if (!requester) return badRequest("Selected requester does not exist or is inactive.");

  // --- Validate projectId ---
  if (d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true, projectNumber: true, name: true, status: true },
    });
    if (!project) return badRequest("Selected project does not exist or is archived.");
    if (PROJECT_TERMINAL.has(project.status)) {
      return badRequest(`Cannot create a procurement request against a ${project.status} project.`);
    }
  }

  // --- Validate taskId ---
  if (d.taskId) {
    const task = await db.task.findFirst({
      where: { id: d.taskId, ...notDeleted() },
      select: { id: true, taskNumber: true, title: true, status: true, projectId: true },
    });
    if (!task) return badRequest("Selected task does not exist or is deleted.");
    if (TASK_TERMINAL.has(task.status)) {
      return badRequest(`Cannot create a procurement request against a ${task.status} task.`);
    }
    if (d.projectId && task.projectId && task.projectId !== d.projectId) {
      return badRequest("Task/project mismatch: the selected task belongs to a different project.");
    }
  }

  // --- Validate supplierId ---
  if (d.supplierId) {
    const supplier = await db.supplier.findFirst({
      where: { id: d.supplierId, ...notDeleted() },
      select: { id: true, supplierNumber: true, tradingName: true, legalName: true, status: true },
    });
    if (!supplier) return badRequest("Selected supplier does not exist or is archived.");
    if (supplier.status === "archived") {
      return badRequest("Selected supplier is archived.");
    }
  }

  const year = new Date().getFullYear();

  try {
    const created = await db.$transaction(async (tx) => {
      const requestNumber = await nextProcurementRequestNumber(tx, year);
      return tx.procurementRequest.create({
        data: {
          requestNumber,
          title: d.title.trim(),
          description: d.description?.trim() || null,
          requesterId: d.requesterId,
          projectId: d.projectId || null,
          taskId: d.taskId || null,
          supplierId: d.supplierId || null,
          priority: d.priority ?? "medium",
          requiredByDate: d.requiredByDate ? new Date(d.requiredByDate) : null,
          notes: d.notes?.trim() || null,
          createdById: auth.ctx.userId,
          updatedById: auth.ctx.userId,
        },
        include: {
          requester: { select: { id: true, fullName: true, employeeNumber: true } },
          project: { select: { id: true, projectNumber: true, name: true } },
          task: { select: { id: true, taskNumber: true, title: true } },
          supplier: { select: { id: true, supplierNumber: true, tradingName: true, legalName: true } },
        },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "procurement",
      recordId: created.id,
      recordType: "ProcurementRequest",
      description: `Created procurement request ${created.requestNumber} (${created.title})`,
      newValue: { requestNumber: created.requestNumber, title: created.title, status: created.status },
    });

    return ok(created, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A race condition occurred while assigning the request number. Please retry.");
    }
    throw err;
  }
}
