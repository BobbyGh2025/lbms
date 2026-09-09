// ============================================================================
// LBMS Phase 5 API — Project team member detail
// ----------------------------------------------------------------------------
// DELETE /api/projects/[id]/team/[memberId]   soft-remove a team member:
//                                             set status="inactive" and
//                                             removedAt=now. Hard-delete is
//                                             never used (preserves audit
//                                             trail of historical membership).
//                                             Requires `projects:edit`.
//                                             Audit recorded with previousValue
//                                             + newValue.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
  notFound,
  badRequest,
  auditFromCtx,
  notDeleted,
} from "@/lib/api-helpers";

interface RouteParams {
  params: Promise<{ id: string; memberId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("projects", "edit");
  if (!auth.ok) return auth.response;

  const { id, memberId } = await params;

  // Verify parent project exists + is not archived
  const project = await db.project.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, projectNumber: true, name: true },
  });
  if (!project) return notFound("Project not found.");

  const existing = await db.projectTeamMember.findFirst({
    where: { id: memberId, projectId: id },
    include: {
      employee: {
        select: { id: true, fullName: true, employeeNumber: true },
      },
    },
  });
  if (!existing) return notFound("Team member not found.");

  // Already-removed memberships are idempotently left as-is
  if (existing.status === "inactive") {
    return badRequest("This team member has already been removed from the project.");
  }

  const updated = await db.projectTeamMember.update({
    where: { id: memberId },
    data: {
      status: "inactive",
      removedAt: new Date(),
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "delete",
    module: "projects",
    recordId: updated.id,
    recordType: "ProjectTeamMember",
    description: `Removed team member ${existing.employee.fullName}${
      existing.employee.employeeNumber ? ` (${existing.employee.employeeNumber})` : ""
    } from project ${project.projectNumber}`,
    previousValue: existing,
    newValue: updated,
  });

  return ok({ id: updated.id, removed: true, status: updated.status });
}
