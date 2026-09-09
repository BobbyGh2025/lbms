// ============================================================================
// LBMS Phase 5 API — Project team collection
// ----------------------------------------------------------------------------
// GET  /api/projects/[id]/team   list team members with employee details.
//                                Active members only, ordered by assignedAt
//                                asc. Requires `projects:view`.
// POST /api/projects/[id]/team   add a team member. Validates:
//                                  • valid employeeId (exists, not deleted)
//                                  • no duplicate (projectId+employeeId unique)
//                                  • cannot add to completed/cancelled projects
//                                Requires `projects:edit`. Audit recorded.
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
// GET /api/projects/[id]/team
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

  const members = await db.projectTeamMember.findMany({
    where: { projectId: id, status: "active" },
    orderBy: { assignedAt: "asc" },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          employeeNumber: true,
          employeeId: true,
          email: true,
          phone: true,
          positionId: true,
          position: {
            select: { id: true, title: true },
          },
          department: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  return ok({ project, items: members });
}

// ---------------------------------------------------------------------------
// POST /api/projects/[id]/team
// ---------------------------------------------------------------------------
const AddTeamMemberSchema = z.object({
  employeeId: z.string().min(1, "employeeId is required"),
  role: z.string().max(100).optional(),
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

  const parsed = AddTeamMemberSchema.safeParse(body);
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
      `Cannot add team members to a ${project.status} project.`,
    );
  }

  // Validate employee existence
  const employee = await db.employee.findFirst({
    where: { id: d.employeeId, ...notDeleted() },
    select: {
      id: true,
      fullName: true,
      employeeNumber: true,
      status: true,
    },
  });
  if (!employee) {
    return badRequest("Selected employee does not exist or is deleted.");
  }

  // Check for duplicate (projectId+employeeId unique) — including inactive
  // records so we can revive them instead of erroring on a constraint.
  const existing = await db.projectTeamMember.findUnique({
    where: {
      projectId_employeeId: { projectId: id, employeeId: d.employeeId },
    },
  });

  try {
    const member = await db.$transaction(async (tx) => {
      if (existing) {
        if (existing.status === "active") {
          // Throwing inside the transaction yields a clean rollback + the
          // outer catch will translate it to a 400.
          throw new DuplicateMemberError(
            "This employee is already an active team member of the project.",
          );
        }
        // Revive a previously-removed membership
        return tx.projectTeamMember.update({
          where: { id: existing.id },
          data: {
            status: "active",
            removedAt: null,
            role: d.role?.trim() || existing.role,
            assignedAt: new Date(),
          },
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                employeeNumber: true,
                email: true,
                phone: true,
              },
            },
          },
        });
      }

      return tx.projectTeamMember.create({
        data: {
          projectId: id,
          employeeId: d.employeeId,
          role: d.role?.trim() || null,
          status: "active",
        },
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              employeeNumber: true,
              email: true,
              phone: true,
            },
          },
        },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "projects",
      recordId: member.id,
      recordType: "ProjectTeamMember",
      description: `Added team member ${employee.fullName}${
        employee.employeeNumber ? ` (${employee.employeeNumber})` : ""
      } to project ${project.projectNumber}${
        d.role ? ` as ${d.role}` : ""
      }`,
      newValue: member,
    });

    return ok(member, 201);
  } catch (err) {
    if (err instanceof DuplicateMemberError) {
      return badRequest(err.message);
    }
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("This employee is already a team member of the project.");
    }
    throw err;
  }
}

class DuplicateMemberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateMemberError";
  }
}
