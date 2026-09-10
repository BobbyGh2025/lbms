// ============================================================================
// LBMS Phase 6 API — Task collection
// ----------------------------------------------------------------------------
// GET  /api/tasks   paginated, searchable, filterable list of operational
//                   tasks. Search matches taskNumber + title. Filters:
//                   status, priority, assignedEmployeeId, projectId,
//                   customerId. Each row includes project name, customer
//                   name, assignee name, and checklist count. Requires
//                   `operations:view`.
// POST /api/tasks   create a new task record. Auto-generates `taskNumber`
//                   as TSK-YYYY-NNNNNN via the TaskRefCounter concurrency-
//                   safe counter inside a single db.$transaction. Validates
//                   projectId (must exist, not be archived, not be in a
//                   terminal state), customerId (must exist + not be
//                   archived), assignedEmployeeId (must exist + not be
//                   deleted). Enforces customer-consistency: if projectId
//                   is set, customerId is derived from the project; an
//                   explicitly-provided customerId that contradicts the
//                   project's customer is rejected with 400. Requires
//                   `operations:create`. Audit recorded.
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
import { nextTaskNumber, TASK_STATUSES, TASK_PRIORITIES } from "@/lib/task-utils";

// ---------------------------------------------------------------------------
// Constants — sortable fields shared across task routes
// ---------------------------------------------------------------------------
export const TASK_SORTABLE_FIELDS = [
  "taskNumber",
  "title",
  "status",
  "priority",
  "dueDate",
  "startDate",
  "completedDate",
  "createdAt",
  "updatedAt",
] as const;

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

/**
 * Decimal-string validator for hour fields (estimatedHours / actualHours).
 * Accepts a positive decimal with up to 2dp. Empty string is treated as "0".
 * We never accept JS numbers for these fields to avoid floating-point
 * corruption in the Decimal column.
 */
const hoursString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, {
    message: "Hours value must be a decimal string (e.g. \"8.50\")",
  })
  .optional()
  .or(z.literal(""));

// ---------------------------------------------------------------------------
// GET /api/tasks
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("operations", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const priority = sp.get("priority")?.trim() || undefined;
  const assignedEmployeeId = sp.get("assignedEmployeeId")?.trim() || undefined;
  const projectId = sp.get("projectId")?.trim() || undefined;
  const customerId = sp.get("customerId")?.trim() || undefined;

  const sortByParam = sp.get("sortBy")?.trim() || "createdAt";
  const sortDir = sp.get("sortDir")?.trim().toLowerCase() === "asc" ? "asc" : "desc";
  const sortBy = (TASK_SORTABLE_FIELDS as readonly string[]).includes(sortByParam)
    ? sortByParam
    : "createdAt";

  const where: Record<string, unknown> = {
    ...notDeleted(),
    ...(search
      ? {
          OR: [
            { taskNumber: { contains: search } },
            { title: { contains: search } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(assignedEmployeeId ? { assignedEmployeeId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(customerId ? { customerId } : {}),
  };

  const [total, items] = await Promise.all([
    db.task.count({ where }),
    db.task.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip,
      take: pageSize,
      include: {
        project: {
          select: {
            id: true,
            projectNumber: true,
            name: true,
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
          },
        },
        assignedEmployee: {
          select: {
            id: true,
            fullName: true,
            employeeNumber: true,
            employeeId: true,
          },
        },
        _count: {
          select: {
            checklists: {},
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
// POST /api/tasks
// ---------------------------------------------------------------------------
const CreateTaskSchema = z.object({
  title: z.string().min(1, "Task title is required").max(300),
  description: z.string().max(5000).optional(),
  projectId: z.string().optional(),
  customerId: z.string().optional(),
  assignedEmployeeId: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: dateString.optional(),
  startDate: dateString.optional(),
  estimatedHours: hoursString,
  actualHours: hoursString,
  notes: z.string().max(5000).optional(),
});

/** Terminal project statuses — a task may not be created against a terminal project. */
const PROJECT_TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

export async function POST(req: NextRequest) {
  const auth = await authorize("operations", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // ------------------------------------------------------------------
  // Validate FK references + cross-field (customer consistency) rules
  // ------------------------------------------------------------------
  let derivedCustomerId: string | null = null;

  // Validate projectId when provided — must exist, not be archived, not be
  // in a terminal state. Customer is derived from the project.
  if (d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: {
        id: true,
        projectNumber: true,
        name: true,
        status: true,
        customerId: true,
      },
    });
    if (!project) {
      return badRequest("Selected project does not exist or is archived.");
    }
    if (PROJECT_TERMINAL_STATUSES.has(project.status)) {
      return badRequest(
        `Cannot create a task against a ${project.status} project.`,
      );
    }
    // Customer consistency check
    if (d.customerId) {
      if (project.customerId && project.customerId !== d.customerId) {
        return badRequest(
          "Customer mismatch: the selected project belongs to a different customer.",
        );
      }
      // Project has no customer, but caller provided one — allowed (and we
      // validate the customer below).
      derivedCustomerId = d.customerId;
    } else {
      // No explicit customer — derive from project.
      derivedCustomerId = project.customerId;
    }
  } else {
    // No project — use caller-provided customer (validated below), if any.
    derivedCustomerId = d.customerId ?? null;
  }

  // Validate customerId when present (either provided by caller or derived)
  if (derivedCustomerId) {
    const cust = await db.customer.findFirst({
      where: { id: derivedCustomerId, ...notDeleted() },
      select: {
        id: true,
        customerNumber: true,
        tradingName: true,
        legalName: true,
      },
    });
    if (!cust) {
      return badRequest("Selected customer does not exist or is archived.");
    }
  }

  // Validate assignedEmployeeId when provided
  if (d.assignedEmployeeId) {
    const emp = await db.employee.findFirst({
      where: { id: d.assignedEmployeeId, ...notDeleted() },
      select: { id: true, fullName: true, employeeNumber: true },
    });
    if (!emp) {
      return badRequest("Selected assignee does not exist or is inactive.");
    }
  }

  // ------------------------------------------------------------------
  // Coerce hour fields (Decimal columns) to safe strings
  // ------------------------------------------------------------------
  const estimatedHours = (d.estimatedHours && d.estimatedHours !== "" ? d.estimatedHours : "0") as string;
  const actualHours = (d.actualHours && d.actualHours !== "" ? d.actualHours : "0") as string;

  const year = new Date().getFullYear();

  // Resolve effective status — defaults to "todo" if caller omits it.
  const status = d.status ?? "todo";

  // Stamp startDate / completedDate based on the initial status so the
  // row is internally consistent. (The /status endpoint will manage these
  // for subsequent transitions.)
  const now = new Date();
  const startDate =
    status === "in_progress" || status === "on_hold" || status === "completed"
      ? d.startDate
        ? new Date(d.startDate)
        : now
      : d.startDate
        ? new Date(d.startDate)
        : null;
  const completedDate =
    status === "completed" ? now : null;

  try {
    const created = await db.$transaction(async (tx) => {
      const taskNumber = await nextTaskNumber(tx, year);

      return tx.task.create({
        data: {
          taskNumber,
          title: d.title.trim(),
          description: d.description?.trim() || null,
          projectId: d.projectId || null,
          customerId: derivedCustomerId,
          assignedEmployeeId: d.assignedEmployeeId || null,
          createdById: auth.ctx.userId,
          status,
          priority: d.priority ?? "medium",
          dueDate: d.dueDate ? new Date(d.dueDate) : null,
          startDate,
          completedDate,
          estimatedHours,
          actualHours,
          notes: d.notes?.trim() || null,
        },
        include: {
          project: {
            select: {
              id: true,
              projectNumber: true,
              name: true,
            },
          },
          customer: {
            select: {
              id: true,
              customerNumber: true,
              tradingName: true,
              legalName: true,
            },
          },
          assignedEmployee: {
            select: { id: true, fullName: true, employeeNumber: true },
          },
        },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "operations",
      recordId: created.id,
      recordType: "Task",
      description: `Created task ${created.taskNumber} (${created.title})`,
      newValue: created,
    });

    return ok(created, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest(
        "A race condition occurred while assigning the task number. Please retry.",
      );
    }
    throw err;
  }
}
