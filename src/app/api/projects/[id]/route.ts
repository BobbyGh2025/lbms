// ============================================================================
// LBMS Phase 5 API — Project detail
// ----------------------------------------------------------------------------
// GET   /api/projects/[id]   single project with customer, projectManager,
//                            teamMembers (with employee details),
//                            milestones, recent journals (10 posted),
//                            recent activities (5). Requires `projects:view`.
// PATCH /api/projects/[id]   update project fields. projectNumber is
//                            IMMUTABLE (rejected if present in body).
//                            Edits blocked when status is "completed" or
//                            "cancelled" (terminal states — must reopen
//                            via /status first). Validates customerId +
//                            projectManagerId when changed. Money fields
//                            accepted as DECIMAL STRINGS only. Requires
//                            `projects:edit`. Audit records previousValue
//                            + newValue.
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
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  getProjectFinanceSummary,
} from "@/lib/project-utils";
import { toMoney, serializeMoney } from "@/lib/finance/money";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const moneyString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, {
    message: "Money value must be a decimal string (e.g. \"5000.00\")",
  })
  .optional()
  .or(z.literal(""));

// Terminal states — cannot be edited via PATCH (must use /status to reopen)
const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

// ---------------------------------------------------------------------------
// GET /api/projects/[id]
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("projects", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const project = await db.project.findFirst({
    where: { id, ...notDeleted() },
    include: {
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
      projectManager: {
        select: {
          id: true,
          fullName: true,
          employeeId: true,
          employeeNumber: true,
          email: true,
          phone: true,
        },
      },
      teamMembers: {
        where: { status: "active" },
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
      },
      milestones: {
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      },
      journals: {
        orderBy: { transactionDate: "desc" },
        take: 10,
        where: { status: "posted" },
        select: {
          id: true,
          reference: true,
          transactionType: true,
          transactionDate: true,
          amount: true,
          currency: true,
          status: true,
          description: true,
        },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          assignedTo: {
            select: { id: true, fullName: true, employeeNumber: true },
          },
        },
      },
      _count: {
        select: {
          teamMembers: { where: { status: "active" } },
          milestones: {},
          journals: { where: { status: "posted" } },
          activities: {},
        },
      },
    },
  });

  if (!project) return notFound("Project not found.");

  // Attach authoritative finance roll-up (derived from Journal ledger,
  // NOT from the denormalised estimate fields on Project).
  const finance = await getProjectFinanceSummary(project.id);

  return ok({ ...project, finance });
}

// ---------------------------------------------------------------------------
// PATCH /api/projects/[id]
// ---------------------------------------------------------------------------
const UpdateProjectSchema = z.object({
  // projectNumber is intentionally omitted — it is immutable.
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  customerId: z.string().nullable().optional(),
  projectManagerId: z.string().nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  priority: z.enum(PROJECT_PRIORITIES).optional(),
  startDate: dateString.nullable().optional(),
  plannedEndDate: dateString.nullable().optional(),
  actualEndDate: dateString.nullable().optional(),
  budgetAmount: moneyString.nullable().optional(),
  estimatedRevenue: moneyString.nullable().optional(),
  estimatedCost: moneyString.nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("projects", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = UpdateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Block any attempt to change projectNumber (immutable per spec)
  if (typeof (body as Record<string, unknown>)?.projectNumber !== "undefined") {
    return badRequest("Project number is immutable and cannot be changed.");
  }

  const existing = await db.project.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Project not found.");

  // Block edits to terminal-state projects (must use /status to reopen first)
  if (TERMINAL_STATUSES.has(existing.status)) {
    return badRequest(
      `Cannot edit a ${existing.status} project. Reopen it via the status endpoint first.`,
    );
  }

  // Reject attempts to move directly into a terminal state via PATCH —
  // lifecycle transitions must go through the dedicated /status endpoint
  // (which enforces the transition graph).
  if (d.status !== undefined && TERMINAL_STATUSES.has(d.status) && d.status !== existing.status) {
    return badRequest(
      `Use the dedicated status endpoint to transition a project to "${d.status}".`,
    );
  }

  // Build the update payload — only fields explicitly present are written.
  const data: Record<string, unknown> = {};

  if (d.name !== undefined) data.name = d.name.trim();
  if (d.description !== undefined) data.description = d.description?.trim() || null;
  if (d.priority !== undefined) data.priority = d.priority;
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;

  // Status (only non-terminal transitions allowed here; terminal ones
  // blocked above)
  if (d.status !== undefined) data.status = d.status;

  // Date fields
  if (d.startDate !== undefined) {
    data.startDate = d.startDate ? new Date(d.startDate) : null;
  }
  if (d.plannedEndDate !== undefined) {
    data.plannedEndDate = d.plannedEndDate ? new Date(d.plannedEndDate) : null;
  }
  if (d.actualEndDate !== undefined) {
    data.actualEndDate = d.actualEndDate ? new Date(d.actualEndDate) : null;
  }

  // Money fields — accept decimal strings only, normalise via toMoney
  if (d.budgetAmount !== undefined) {
    data.budgetAmount = serializeMoney(toMoney(d.budgetAmount || "0"));
  }
  if (d.estimatedRevenue !== undefined) {
    data.estimatedRevenue = serializeMoney(toMoney(d.estimatedRevenue || "0"));
  }
  if (d.estimatedCost !== undefined) {
    data.estimatedCost = serializeMoney(toMoney(d.estimatedCost || "0"));
  }

  // FK fields
  if (d.customerId !== undefined) {
    data.customerId = d.customerId || null;
  }
  if (d.projectManagerId !== undefined) {
    data.projectManagerId = d.projectManagerId || null;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Validation of referenced entities + cross-field rules
  // ───────────────────────────────────────────────────────────────────────

  // customerId — must exist + not be archived
  if (data.customerId !== undefined && data.customerId !== null) {
    const cust = await db.customer.findFirst({
      where: { id: data.customerId as string, ...notDeleted() },
      select: { id: true },
    });
    if (!cust) {
      return badRequest("Selected customer does not exist or is archived.");
    }
  }

  // projectManagerId — must exist + not be deleted
  if (data.projectManagerId !== undefined && data.projectManagerId !== null) {
    const mgr = await db.employee.findFirst({
      where: { id: data.projectManagerId as string, ...notDeleted() },
      select: { id: true, fullName: true },
    });
    if (!mgr) {
      return badRequest("Selected project manager does not exist or is inactive.");
    }
  }

  // Date order: plannedEndDate >= startDate (using effective values)
  const effectiveStart = data.startDate !== undefined ? data.startDate : existing.startDate;
  const effectiveEnd = data.plannedEndDate !== undefined ? data.plannedEndDate : existing.plannedEndDate;
  if (effectiveStart && effectiveEnd && new Date(effectiveEnd as Date) < new Date(effectiveStart as Date)) {
    return badRequest("Planned end date cannot be before start date.");
  }

  if (Object.keys(data).length === 0) {
    return badRequest("No fields provided to update.");
  }

  data.updatedById = auth.ctx.userId;
  data.updatedAt = new Date();

  const updated = await db.project.update({
    where: { id },
    data,
    include: {
      customer: {
        select: { id: true, customerNumber: true, tradingName: true, legalName: true },
      },
      projectManager: {
        select: { id: true, fullName: true, employeeNumber: true },
      },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "projects",
    recordId: updated.id,
    recordType: "Project",
    description: `Updated project ${updated.projectNumber} (${updated.name})`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
