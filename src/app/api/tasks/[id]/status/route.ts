// ============================================================================
// LBMS Phase 6 API — Task lifecycle status transition
// ----------------------------------------------------------------------------
// POST /api/tasks/[id]/status   transition a task between lifecycle states.
//                               Body: { status }.
//                               Valid transitions enforced server-side via
//                               TASK_TRANSITIONS map:
//                                 todo        → in_progress | cancelled
//                                 in_progress → on_hold | completed | cancelled
//                                 on_hold     → in_progress
//                                 completed   /  cancelled are terminal
//                               (no outbound edges).
//                               When transitioning to "in_progress",
//                               startDate is stamped = now IF NOT already
//                               set. When transitioning to "completed",
//                               completedDate is stamped = now.
//                               Requires `operations:edit`. Audit recorded
//                               with previousValue + newValue.
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
  TASK_TRANSITIONS_LIST,
  isValidTaskTransition,
} from "@/lib/task-utils";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const TransitionSchema = z.object({
  status: z.enum(TASK_STATUSES),
  reason: z.string().max(500).optional(),
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

  const parsed = TransitionSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  const existing = await db.task.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Task not found.");

  const from = existing.status;
  const to = d.status;

  // No-op: same status
  if (from === to) {
    return badRequest(`Task is already in status "${to}".`);
  }

  // Enforce the transition graph
  if (!isValidTaskTransition(from, to)) {
    return badRequest(
      `Invalid lifecycle transition: ${from} → ${to}. Allowed transitions from "${from}": ${
        (TASK_TRANSITIONS_LIST[from] ?? []).join(", ") || "(none — terminal state)"
      }`,
    );
  }

  const data: Record<string, unknown> = {
    status: to,
    updatedAt: new Date(),
  };

  // Stamp startDate when transitioning to in_progress (if not already set).
  if (to === "in_progress" && !existing.startDate) {
    data.startDate = new Date();
  }

  // Stamp completedDate when transitioning to completed.
  if (to === "completed") {
    data.completedDate = new Date();
    // Backfill startDate if it was somehow never set.
    if (!existing.startDate) {
      data.startDate = existing.startDate ?? new Date();
    }
  }

  const updated = await db.task.update({
    where: { id },
    data,
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "operations",
    recordId: updated.id,
    recordType: "Task",
    description: `Transitioned task ${updated.taskNumber} (${updated.title}) status: ${from} → ${to}${
      d.reason ? ` — reason: ${d.reason}` : ""
    }`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
