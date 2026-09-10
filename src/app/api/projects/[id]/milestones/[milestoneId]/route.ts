// ============================================================================
// LBMS Phase 5 API — Project milestone detail
// ----------------------------------------------------------------------------
// PATCH /api/projects/[id]/milestones/[milestoneId]   update milestone
//   fields. Supports:
//     • partial update of name/description/dueDate/status
//     • completing a milestone: set status="completed" → auto-stamps
//       completedDate=now (if not already set)
//     • un-completing (status="pending") clears completedDate
//   Requires `projects:edit`. Audit recorded with previousValue + newValue.
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
  params: Promise<{ id: string; milestoneId: string }>;
}

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const UpdateMilestoneSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  dueDate: dateString.nullable().optional(),
  status: z.enum(["pending", "completed", "cancelled"]).optional(),
  completedDate: dateString.nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("projects", "edit");
  if (!auth.ok) return auth.response;

  const { id, milestoneId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = UpdateMilestoneSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Verify parent project exists + not archived
  const project = await db.project.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, projectNumber: true, name: true },
  });
  if (!project) return notFound("Project not found.");

  const existing = await db.projectMilestone.findFirst({
    where: { id: milestoneId, projectId: id },
  });
  if (!existing) return notFound("Milestone not found.");

  const data: Record<string, unknown> = {};

  if (d.name !== undefined) data.name = d.name.trim();
  if (d.description !== undefined) data.description = d.description?.trim() || null;
  if (d.dueDate !== undefined) {
    data.dueDate = d.dueDate ? new Date(d.dueDate) : null;
  }

  // Status change handling — including the "complete a milestone" shortcut
  if (d.status !== undefined && d.status !== existing.status) {
    data.status = d.status;
    if (d.status === "completed") {
      // Auto-stamp completedDate if not provided explicitly
      data.completedDate = d.completedDate ? new Date(d.completedDate) : new Date();
    } else {
      // Transitioning out of completed — clear completedDate
      data.completedDate = null;
    }
  } else if (d.completedDate !== undefined) {
    // Allow caller to explicitly set/clear completedDate independent of status
    data.completedDate = d.completedDate ? new Date(d.completedDate) : null;
    // If they set a completedDate but status is still pending, promote to completed
    if (d.completedDate && existing.status === "pending") {
      data.status = "completed";
    }
  }

  if (Object.keys(data).length === 0) {
    return badRequest("No fields provided to update.");
  }

  const updated = await db.projectMilestone.update({
    where: { id: milestoneId },
    data,
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "projects",
    recordId: updated.id,
    recordType: "ProjectMilestone",
    description: `Updated milestone "${updated.name}" on project ${project.projectNumber}${
      existing.status !== updated.status ? ` (status: ${existing.status} → ${updated.status})` : ""
    }`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
