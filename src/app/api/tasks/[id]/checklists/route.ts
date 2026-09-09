// ============================================================================
// LBMS Phase 6 API — Task checklists collection
// ----------------------------------------------------------------------------
// GET  /api/tasks/[id]/checklists   list checklists for a task, each with
//                                   its items (ordered by [order, createdAt]).
//                                   Requires `operations:view`.
// POST /api/tasks/[id]/checklists   create a checklist on a task. The task
//                                   must exist and not be soft-deleted.
//                                   Requires `operations:edit`. Audit
//                                   recorded.
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

interface RouteParams {
  params: Promise<{ id: string }>;
}

const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

// ---------------------------------------------------------------------------
// GET /api/tasks/[id]/checklists
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("operations", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  // Verify the parent task exists and is not soft-deleted
  const task = await db.task.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true,
      taskNumber: true,
      title: true,
      status: true,
    },
  });
  if (!task) return notFound("Task not found.");

  const checklists = await db.taskChecklist.findMany({
    where: { taskId: id },
    orderBy: { createdAt: "asc" },
    include: {
      items: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      },
      _count: { select: { items: {} } },
    },
  });

  return ok({ task, items: checklists });
}

// ---------------------------------------------------------------------------
// POST /api/tasks/[id]/checklists
// ---------------------------------------------------------------------------
const CreateChecklistSchema = z.object({
  name: z.string().min(1, "Checklist name is required").max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(["active", "completed"]).optional(),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("operations", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateChecklistSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Verify parent task exists + not archived + not in a terminal state.
  // We block checklist creation on terminal tasks because the task is
  // considered done; reopen via /status to add more checklists.
  const task = await db.task.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true,
      taskNumber: true,
      title: true,
      status: true,
    },
  });
  if (!task) return notFound("Task not found.");

  if (TERMINAL_STATUSES.has(task.status)) {
    return badRequest(
      `Cannot add checklists to a ${task.status} task.`,
    );
  }

  const created = await db.taskChecklist.create({
    data: {
      taskId: id,
      name: d.name.trim(),
      description: d.description?.trim() || null,
      status: d.status ?? "active",
    },
    include: {
      items: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "create",
    module: "operations",
    recordId: created.id,
    recordType: "TaskChecklist",
    description: `Created checklist "${created.name}" on task ${task.taskNumber}`,
    newValue: created,
  });

  return ok(created, 201);
}
