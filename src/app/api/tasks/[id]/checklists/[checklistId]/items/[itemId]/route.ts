// ============================================================================
// LBMS Phase 6 API — Task checklist item detail
// ----------------------------------------------------------------------------
// PATCH /api/tasks/[id]/checklists/[checklistId]/items/[itemId]
//   Toggle / update a single checklist item. Accepts:
//     • { isCompleted: boolean } — toggles completion. When setting to
//       true, completedAt is stamped = now (if not already set). When
//       setting to false, completedAt is cleared.
//     • { description?: string, order?: number } — optionally update the
//       item's description or sort order.
//   The task must exist and not be in a terminal state (completed /
//   cancelled). Requires `operations:edit`. Audit recorded with
//   previousValue + newValue.
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
  params: Promise<{ id: string; checklistId: string; itemId: string }>;
}

const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

const UpdateItemSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  isCompleted: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  completedAt: z
    .string()
    .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" })
    .nullable()
    .optional(),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("operations", "edit");
  if (!auth.ok) return auth.response;

  const { id, checklistId, itemId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = UpdateItemSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Verify parent task exists + not archived + not in a terminal state
  const task = await db.task.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, taskNumber: true, title: true, status: true },
  });
  if (!task) return notFound("Task not found.");

  if (TERMINAL_STATUSES.has(task.status)) {
    return badRequest(
      `Cannot modify checklist items on a ${task.status} task.`,
    );
  }

  // Verify the parent checklist exists + belongs to the task
  const checklist = await db.taskChecklist.findFirst({
    where: { id: checklistId, taskId: id },
    select: { id: true, name: true },
  });
  if (!checklist) return notFound("Checklist not found.");

  const existing = await db.taskChecklistItem.findFirst({
    where: { id: itemId, checklistId },
  });
  if (!existing) return notFound("Checklist item not found.");

  const data: Record<string, unknown> = {};

  if (d.description !== undefined) data.description = d.description.trim();
  if (d.order !== undefined) data.order = d.order;

  // isCompleted toggle — auto-manage completedAt unless caller provides
  // an explicit completedAt value.
  if (d.isCompleted !== undefined && d.isCompleted !== existing.isCompleted) {
    data.isCompleted = d.isCompleted;
    if (d.completedAt !== undefined) {
      // Explicit override
      data.completedAt = d.completedAt ? new Date(d.completedAt) : null;
    } else if (d.isCompleted) {
      // Completing — stamp now (preserve existing timestamp if present).
      data.completedAt = existing.completedAt ?? new Date();
    } else {
      // Un-completing — clear timestamp.
      data.completedAt = null;
    }
  } else if (d.completedAt !== undefined) {
    // Caller set completedAt independently of isCompleted — sync the flag.
    data.completedAt = d.completedAt ? new Date(d.completedAt) : null;
    const targetCompleted = !!d.completedAt;
    if (targetCompleted !== existing.isCompleted) {
      data.isCompleted = targetCompleted;
    }
  }

  if (Object.keys(data).length === 0) {
    return badRequest("No fields provided to update.");
  }

  data.updatedAt = new Date();

  const updated = await db.taskChecklistItem.update({
    where: { id: itemId },
    data,
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "operations",
    recordId: updated.id,
    recordType: "TaskChecklistItem",
    description: `Updated checklist item "${updated.description}" on task ${task.taskNumber}${
      existing.isCompleted !== updated.isCompleted
        ? ` (isCompleted: ${existing.isCompleted} → ${updated.isCompleted})`
        : ""
    }`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
