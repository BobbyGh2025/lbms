// ============================================================================
// LBMS Phase 6 API — Task checklist detail
// ----------------------------------------------------------------------------
// PATCH /api/tasks/[id]/checklists/[checklistId]
//   Update a checklist on a task. Supports two operation modes:
//
//   1. Field update — body: { name?, description?, status? }
//        Updates the checklist's name / description / status. The task
//        must not be in a terminal state (completed/cancelled). Requires
//        `operations:edit`. Audit recorded with previousValue + newValue.
//
//   2. Add items — body: { items: [{ description, order }] }
//        Adds one or more new items to the checklist in a single
//        db.$transaction. Each item is created with isCompleted=false.
//        The task must not be in a terminal state. Requires
//        `operations:edit`. Audit recorded with newValue = list of
//        created items.
//
//   The two modes are distinguished by the presence of the `items` array
//   in the request body — when present, mode 2 is invoked (and any
//   name/description/status fields in the body are ignored).
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
  params: Promise<{ id: string; checklistId: string }>;
}

const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

const FieldUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["active", "completed"]).optional(),
});

const AddItemsSchema = z.object({
  items: z
    .array(
      z.object({
        description: z.string().min(1, "Item description is required").max(500),
        order: z.number().int().min(0).default(0),
      }),
    )
    .min(1, "At least one item is required"),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("operations", "edit");
  if (!auth.ok) return auth.response;

  const { id, checklistId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  // Verify parent task exists + not archived + not in a terminal state
  const task = await db.task.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, taskNumber: true, title: true, status: true },
  });
  if (!task) return notFound("Task not found.");

  if (TERMINAL_STATUSES.has(task.status)) {
    return badRequest(
      `Cannot modify checklists on a ${task.status} task.`,
    );
  }

  const existing = await db.taskChecklist.findFirst({
    where: { id: checklistId, taskId: id },
    include: {
      items: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!existing) return notFound("Checklist not found.");

  // ───────────────────────────────────────────────────────────────────────
  // Mode 2: add items (when body contains an `items` array)
  // ───────────────────────────────────────────────────────────────────────
  if (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as Record<string, unknown>).items)
  ) {
    const parsedItems = AddItemsSchema.safeParse(body);
    if (!parsedItems.success) {
      return badRequest(
        parsedItems.error.issues[0]?.message ?? "Validation failed",
        parsedItems.error.issues,
      );
    }

    const createdItems = await db.$transaction(
      parsedItems.data.items.map((item) =>
        db.taskChecklistItem.create({
          data: {
            checklistId,
            description: item.description.trim(),
            order: item.order,
            isCompleted: false,
            completedAt: null,
          },
        }),
      ),
    );

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "operations",
      recordId: checklistId,
      recordType: "TaskChecklistItem",
      description: `Added ${createdItems.length} item(s) to checklist "${existing.name}" on task ${task.taskNumber}`,
      newValue: createdItems,
    });

    return ok({ added: createdItems }, 201);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Mode 1: field update
  // ───────────────────────────────────────────────────────────────────────
  const parsed = FieldUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  const data: Record<string, unknown> = {};

  if (d.name !== undefined) data.name = d.name.trim();
  if (d.description !== undefined) data.description = d.description?.trim() || null;
  if (d.status !== undefined) data.status = d.status;

  if (Object.keys(data).length === 0) {
    return badRequest("No fields provided to update.");
  }

  data.updatedAt = new Date();

  const updated = await db.taskChecklist.update({
    where: { id: checklistId },
    data,
    include: {
      items: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "operations",
    recordId: updated.id,
    recordType: "TaskChecklist",
    description: `Updated checklist "${updated.name}" on task ${task.taskNumber}`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
