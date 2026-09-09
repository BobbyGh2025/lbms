// ============================================================================
// LBMS Phase 5 API — Project milestones collection
// ----------------------------------------------------------------------------
// GET  /api/projects/[id]/milestones   list milestones for a project,
//                                      ordered by dueDate asc then createdAt
//                                      asc. Requires `projects:view`.
// POST /api/projects/[id]/milestones   create a milestone. Requires
//                                      `projects:edit`. Audit recorded.
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

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/projects/[id]/milestones
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("projects", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  // Verify the parent project exists and is not archived
  const project = await db.project.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true,
      projectNumber: true,
      name: true,
      status: true,
    },
  });
  if (!project) return notFound("Project not found.");

  const milestones = await db.projectMilestone.findMany({
    where: { projectId: id },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });

  return ok({ project, items: milestones });
}

// ---------------------------------------------------------------------------
// POST /api/projects/[id]/milestones
// ---------------------------------------------------------------------------
const CreateMilestoneSchema = z.object({
  name: z.string().min(1, "Milestone name is required").max(200),
  description: z.string().max(2000).optional(),
  dueDate: dateString.optional(),
  status: z.enum(["pending", "completed", "cancelled"]).optional(),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("projects", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateMilestoneSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Verify parent project exists + not archived + not in terminal state
  const project = await db.project.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true,
      projectNumber: true,
      name: true,
      status: true,
    },
  });
  if (!project) return notFound("Project not found.");

  if (TERMINAL_STATUSES.has(project.status)) {
    return badRequest(
      `Cannot add milestones to a ${project.status} project.`,
    );
  }

  const created = await db.projectMilestone.create({
    data: {
      projectId: id,
      name: d.name.trim(),
      description: d.description?.trim() || null,
      dueDate: d.dueDate ? new Date(d.dueDate) : null,
      status: d.status ?? "pending",
      completedDate: d.status === "completed" ? new Date() : null,
      createdById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "create",
    module: "projects",
    recordId: created.id,
    recordType: "ProjectMilestone",
    description: `Created milestone "${created.name}" on project ${project.projectNumber}${
      created.dueDate ? ` (due ${created.dueDate.toISOString().slice(0, 10)})` : ""
    }`,
    newValue: created,
  });

  return ok(created, 201);
}
