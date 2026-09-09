// ============================================================================
// LBMS Phase 6 API — Task detail
// ----------------------------------------------------------------------------
// GET   /api/tasks/[id]   single task with project, customer, assignee,
//                        creator, and checklists (with their items).
//                        Requires `operations:view`.
// PATCH /api/tasks/[id]  update task fields. taskNumber is IMMUTABLE
//                        (rejected if present in body). Edits blocked
//                        when status is "completed" or "cancelled"
//                        (terminal states — must reopen via /status first).
//                        Validates projectId (must not be terminal),
//                        customerId, assignedEmployeeId when changed.
//                        Enforces customer consistency when projectId is
//                        present. Hours fields accepted as DECIMAL STRINGS
//                        only. Status changes go through the /status
//                        endpoint (only non-terminal transitions allowed
//                        here, terminal ones blocked). Requires
//                        `operations:edit`. Audit records previousValue
//                        + newValue.
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
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_TERMINAL_STATUSES,
} from "@/lib/task-utils";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const hoursString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, {
    message: "Hours value must be a decimal string (e.g. \"8.50\")",
  })
  .optional()
  .or(z.literal(""));

/** Terminal project statuses — a task may not be reassigned to a terminal project. */
const PROJECT_TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

// ---------------------------------------------------------------------------
// GET /api/tasks/[id]
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("operations", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const task = await db.task.findFirst({
    where: { id, ...notDeleted() },
    include: {
      project: {
        select: {
          id: true,
          projectNumber: true,
          name: true,
          status: true,
        },
      },
      customer: {
        select: {
          id: true,
          customerNumber: true,
          tradingName: true,
          legalName: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      assignedEmployee: {
        select: {
          id: true,
          fullName: true,
          employeeId: true,
          employeeNumber: true,
          email: true,
          phone: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          email: true,
          username: true,
        },
      },
      checklists: {
        orderBy: { createdAt: "asc" },
        include: {
          items: {
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          },
        },
      },
    },
  });

  if (!task) return notFound("Task not found.");

  return ok(task);
}

// ---------------------------------------------------------------------------
// PATCH /api/tasks/[id]
// ---------------------------------------------------------------------------
const UpdateTaskSchema = z.object({
  // taskNumber is intentionally omitted — it is immutable.
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).nullable().optional(),
  projectId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  assignedEmployeeId: z.string().nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: dateString.nullable().optional(),
  startDate: dateString.nullable().optional(),
  estimatedHours: hoursString.nullable().optional(),
  actualHours: hoursString.nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("operations", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = UpdateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Block any attempt to change taskNumber (immutable per spec)
  if (typeof (body as Record<string, unknown>)?.taskNumber !== "undefined") {
    return badRequest("Task number is immutable and cannot be changed.");
  }

  const existing = await db.task.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Task not found.");

  // Block edits to terminal-state tasks (must use /status to reopen first)
  if (TASK_TERMINAL_STATUSES.has(existing.status)) {
    return badRequest(
      `Cannot edit a ${existing.status} task. Reopen it via the status endpoint first.`,
    );
  }

  // Reject attempts to move directly into a terminal state via PATCH —
  // lifecycle transitions must go through the dedicated /status endpoint.
  if (d.status !== undefined && TASK_TERMINAL_STATUSES.has(d.status) && d.status !== existing.status) {
    return badRequest(
      `Use the dedicated status endpoint to transition a task to "${d.status}".`,
    );
  }

  // Build the update payload — only fields explicitly present are written.
  const data: Record<string, unknown> = {};

  if (d.title !== undefined) data.title = d.title.trim();
  if (d.description !== undefined) data.description = d.description?.trim() || null;
  if (d.priority !== undefined) data.priority = d.priority;
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;
  if (d.status !== undefined) data.status = d.status;

  if (d.dueDate !== undefined) {
    data.dueDate = d.dueDate ? new Date(d.dueDate) : null;
  }
  if (d.startDate !== undefined) {
    data.startDate = d.startDate ? new Date(d.startDate) : null;
  }

  if (d.estimatedHours !== undefined) {
    data.estimatedHours = d.estimatedHours && d.estimatedHours !== "" ? d.estimatedHours : "0";
  }
  if (d.actualHours !== undefined) {
    data.actualHours = d.actualHours && d.actualHours !== "" ? d.actualHours : "0";
  }

  // ───────────────────────────────────────────────────────────────────────
  // FK validation + customer-consistency rule
  // ───────────────────────────────────────────────────────────────────────

  // Resolve the effective projectId / customerId values
  const effectiveProjectId =
    d.projectId !== undefined ? (d.projectId || null) : existing.projectId;
  const effectiveCustomerId =
    d.customerId !== undefined ? (d.customerId || null) : existing.customerId;

  // If a project is referenced (either new or existing), re-validate it and
  // enforce customer consistency. This guards against a project being
  // archived or moved to a terminal state after the task was created.
  let resolvedCustomerId = effectiveCustomerId;
  if (effectiveProjectId) {
    // Only re-fetch if projectId is being changed OR if customerId is being
    // changed (we need the project's current customer for the consistency
    // check). For an unchanged projectId + unchanged customerId we can skip
    // the round-trip (the values were validated at create time).
    if (d.projectId !== undefined || d.customerId !== undefined) {
      const project = await db.project.findFirst({
        where: { id: effectiveProjectId, ...notDeleted() },
        select: { id: true, projectNumber: true, status: true, customerId: true },
      });
      if (!project) {
        return badRequest("Selected project does not exist or is archived.");
      }
      if (PROJECT_TERMINAL_STATUSES.has(project.status)) {
        return badRequest(
          `Cannot attach a task to a ${project.status} project.`,
        );
      }
      // Customer consistency: project.customerId (if any) wins.
      if (project.customerId) {
        if (effectiveCustomerId && effectiveCustomerId !== project.customerId) {
          return badRequest(
            "Customer mismatch: the selected project belongs to a different customer.",
          );
        }
        resolvedCustomerId = project.customerId;
      } else {
        // Project has no customer — use the caller-provided customer (if any).
        resolvedCustomerId = effectiveCustomerId;
      }
    }
  } else {
    // No project — explicit customer (or null) is fine.
    resolvedCustomerId = effectiveCustomerId;
  }

  if (d.projectId !== undefined) {
    data.projectId = effectiveProjectId;
  }
  if (d.customerId !== undefined || resolvedCustomerId !== effectiveCustomerId) {
    data.customerId = resolvedCustomerId;
  }

  // Validate referenced customer when set
  if (
    (d.customerId !== undefined || data.customerId !== undefined) &&
    resolvedCustomerId
  ) {
    const cust = await db.customer.findFirst({
      where: { id: resolvedCustomerId, ...notDeleted() },
      select: { id: true },
    });
    if (!cust) {
      return badRequest("Selected customer does not exist or is archived.");
    }
  }

  // Validate referenced assignee
  const effectiveAssigneeId =
    d.assignedEmployeeId !== undefined
      ? (d.assignedEmployeeId || null)
      : existing.assignedEmployeeId;
  if (d.assignedEmployeeId !== undefined) {
    data.assignedEmployeeId = effectiveAssigneeId;
  }
  if (effectiveAssigneeId) {
    const emp = await db.employee.findFirst({
      where: { id: effectiveAssigneeId, ...notDeleted() },
      select: { id: true, fullName: true },
    });
    if (!emp) {
      return badRequest("Selected assignee does not exist or is inactive.");
    }
  }

  if (Object.keys(data).length === 0) {
    return badRequest("No fields provided to update.");
  }

  data.updatedAt = new Date();

  const updated = await db.task.update({
    where: { id },
    data,
    include: {
      project: {
        select: { id: true, projectNumber: true, name: true },
      },
      customer: {
        select: { id: true, customerNumber: true, tradingName: true, legalName: true },
      },
      assignedEmployee: {
        select: { id: true, fullName: true, employeeNumber: true },
      },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "operations",
    recordId: updated.id,
    recordType: "Task",
    description: `Updated task ${updated.taskNumber} (${updated.title})`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
