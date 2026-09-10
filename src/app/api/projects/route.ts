// ============================================================================
// LBMS Phase 5 API — Project collection
// ----------------------------------------------------------------------------
// GET  /api/projects   paginated, searchable, filterable list of projects.
//                      Search matches projectNumber + name. Filters: status,
//                      customerId, projectManagerId, priority. Each row
//                      includes customer name, manager name, team count,
//                      milestone count. Requires `projects:view`.
// POST /api/projects   create a new project record. Auto-generates
//                      `projectNumber` as PRJ-YYYY-NNNNNN via the
//                      ProjectRefCounter concurrency-safe counter inside a
//                      single db.$transaction. Validates customerId + manager
//                      FK existence. Money fields (budgetAmount,
//                      estimatedRevenue, estimatedCost) accepted as DECIMAL
//                      STRINGS only (never JS Number). Requires
//                      `projects:create`. Audit recorded.
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
import { nextProjectNumber, PROJECT_STATUSES, PROJECT_PRIORITIES } from "@/lib/project-utils";
import { toMoney, serializeMoney } from "@/lib/finance/money";

// ---------------------------------------------------------------------------
// Constants — shared across project routes
// ---------------------------------------------------------------------------
export const PROJECT_SORTABLE_FIELDS = [
  "projectNumber",
  "name",
  "status",
  "priority",
  "startDate",
  "plannedEndDate",
  "actualEndDate",
  "createdAt",
  "updatedAt",
] as const;

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

/**
 * Money string validator — accepts a string matching the canonical money
 * regex (positive decimal with up to 2dp). Empty string is treated as 0.
 * We never accept JS numbers for money to avoid floating-point corruption.
 */
const moneyString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, {
    message: "Money value must be a decimal string (e.g. \"5000.00\")",
  })
  .optional()
  .or(z.literal(""));

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("projects", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const customerId = sp.get("customerId")?.trim() || undefined;
  const projectManagerId = sp.get("projectManagerId")?.trim() || undefined;
  const priority = sp.get("priority")?.trim() || undefined;

  const sortByParam = sp.get("sortBy")?.trim() || "createdAt";
  const sortDir = sp.get("sortDir")?.trim().toLowerCase() === "asc" ? "asc" : "desc";
  const sortBy = (PROJECT_SORTABLE_FIELDS as readonly string[]).includes(sortByParam)
    ? sortByParam
    : "createdAt";

  const where: Record<string, unknown> = {
    ...notDeleted(),
    ...(search
      ? {
          OR: [
            { projectNumber: { contains: search } },
            { name: { contains: search } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
    ...(customerId ? { customerId } : {}),
    ...(projectManagerId ? { projectManagerId } : {}),
    ...(priority ? { priority } : {}),
  };

  const [total, items] = await Promise.all([
    db.project.count({ where }),
    db.project.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip,
      take: pageSize,
      include: {
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
        projectManager: {
          select: {
            id: true,
            fullName: true,
            employeeNumber: true,
            employeeId: true,
          },
        },
        _count: {
          select: {
            teamMembers: { where: { status: "active" } },
            milestones: {},
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
// POST /api/projects
// ---------------------------------------------------------------------------
const CreateProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(200),
  description: z.string().max(5000).optional(),
  customerId: z.string().optional(),
  projectManagerId: z.string().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  priority: z.enum(PROJECT_PRIORITIES).optional(),
  startDate: dateString.optional(),
  plannedEndDate: dateString.optional(),
  budgetAmount: moneyString,
  estimatedRevenue: moneyString,
  estimatedCost: moneyString,
  notes: z.string().max(5000).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("projects", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Validate customerId (Customer FK) when provided
  if (d.customerId) {
    const cust = await db.customer.findFirst({
      where: { id: d.customerId, ...notDeleted() },
      select: { id: true, customerNumber: true, tradingName: true, legalName: true },
    });
    if (!cust) {
      return badRequest("Selected customer does not exist or is archived.");
    }
  }

  // Validate projectManagerId (Employee FK) when provided
  if (d.projectManagerId) {
    const mgr = await db.employee.findFirst({
      where: { id: d.projectManagerId, ...notDeleted() },
      select: { id: true, fullName: true, employeeNumber: true },
    });
    if (!mgr) {
      return badRequest("Selected project manager does not exist or is inactive.");
    }
  }

  // Validate date order — plannedEndDate must be on/after startDate when both set
  if (d.startDate && d.plannedEndDate) {
    if (new Date(d.plannedEndDate) < new Date(d.startDate)) {
      return badRequest("Planned end date cannot be before start date.");
    }
  }

  // Coerce money fields to safe Decimal strings (empty → "0")
  const budgetAmount = serializeMoney(toMoney(d.budgetAmount || "0"));
  const estimatedRevenue = serializeMoney(toMoney(d.estimatedRevenue || "0"));
  const estimatedCost = serializeMoney(toMoney(d.estimatedCost || "0"));

  const year = new Date().getFullYear();

  try {
    const created = await db.$transaction(async (tx) => {
      const projectNumber = await nextProjectNumber(tx, year);

      return tx.project.create({
        data: {
          projectNumber,
          name: d.name.trim(),
          description: d.description?.trim() || null,
          customerId: d.customerId || null,
          projectManagerId: d.projectManagerId || null,
          status: d.status ?? "planning",
          priority: d.priority ?? "medium",
          startDate: d.startDate ? new Date(d.startDate) : null,
          plannedEndDate: d.plannedEndDate ? new Date(d.plannedEndDate) : null,
          budgetAmount,
          estimatedRevenue,
          estimatedCost,
          notes: d.notes?.trim() || null,
          createdById: auth.ctx.userId,
          updatedById: auth.ctx.userId,
        },
        include: {
          customer: {
            select: {
              id: true,
              customerNumber: true,
              tradingName: true,
              legalName: true,
            },
          },
          projectManager: {
            select: { id: true, fullName: true, employeeNumber: true },
          },
        },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "projects",
      recordId: created.id,
      recordType: "Project",
      description: `Created project ${created.projectNumber} (${created.name})`,
      newValue: created,
    });

    return ok(created, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest(
        "A race condition occurred while assigning the project number. Please retry.",
      );
    }
    throw err;
  }
}
