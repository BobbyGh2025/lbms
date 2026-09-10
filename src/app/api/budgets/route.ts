// ============================================================================
// LBMS Phase 12 API — Budgets collection
// ----------------------------------------------------------------------------
// GET  /api/budgets   paginated, searchable, filterable list.
//   Filters: status, fiscalYear, search (matches budgetNumber + name).
//   Requires `budgets:view`.
// POST /api/budgets   create a DRAFT budget (auto BUD-YYYY-NNNNNN).
//   Requires name + fiscalYear + startDate + endDate. Optional description.
//   Total amount is ALWAYS server-calculated (Σ BudgetLine.amount). The
//   client may NEVER supply totalAmount.
//   Requires `budgets:create`.
//
// Budget = management planning record. NEVER posts a journal. Actuals always
// come from the authoritative Finance ledger via getFinanceSummary.
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
import { nextBudgetRefNumber } from "@/lib/budget-utils";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const CreateBudgetSchema = z.object({
  name: z.string().min(1, "Budget name is required").max(200),
  description: z.string().max(5000).optional(),
  fiscalYear: z
    .number()
    .int()
    .min(2000, "Fiscal year must be at least 2000")
    .max(2100, "Fiscal year must be at most 2100"),
  startDate: dateString,
  endDate: dateString,
  currency: z.string().max(3).optional(),
});

// ---------------------------------------------------------------------------
// GET /api/budgets
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("budgets", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const fiscalYear = sp.get("fiscalYear")?.trim() || undefined;

  const where: Record<string, unknown> = {
    ...notDeleted(),
    ...(search
      ? {
          OR: [
            { budgetNumber: { contains: search } },
            { name: { contains: search } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
    ...(fiscalYear ? { fiscalYear: Number(fiscalYear) } : {}),
  };

  const [total, rawItems] = await Promise.all([
    db.budget.count({ where }),
    db.budget.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        submittedBy: { select: { id: true, username: true } },
        approvedBy: { select: { id: true, username: true } },
        lockedBy: { select: { id: true, username: true } },
        createdBy: { select: { id: true, username: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  const items = rawItems.map((b) => ({
    ...b,
    lineCount: b._count.lines,
    _count: undefined,
  }));

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
// POST /api/budgets
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const auth = await authorize("budgets", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateBudgetSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(
      parsed.error.issues[0]?.message ?? "Validation failed",
      parsed.error.issues,
    );
  }
  const d = parsed.data;

  const start = new Date(d.startDate);
  const end = new Date(d.endDate);
  if (end <= start) {
    return badRequest("End date must be after start date.");
  }

  // Optional: warn (not block) if a budget for this fiscal year already exists.
  // Versioning is per-record (a new budget record = a new version); multiple
  // budgets in the same fiscal year are allowed.

  const year = d.fiscalYear;

  try {
    const created = await db.$transaction(async (tx) => {
      const budgetNumber = await nextBudgetRefNumber(tx, year);
      return tx.budget.create({
        data: {
          budgetNumber,
          name: d.name.trim(),
          description: d.description?.trim() || null,
          fiscalYear: d.fiscalYear,
          startDate: start,
          endDate: end,
          status: "draft",
          version: 1,
          currency: d.currency?.toUpperCase() || "GHS",
          totalAmount: "0", // always server-calculated; starts at 0 with no lines
          createdById: auth.ctx.userId,
          updatedById: auth.ctx.userId,
        },
        include: {
          createdBy: { select: { id: true, username: true } },
        },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "budgets",
      recordId: created.id,
      recordType: "Budget",
      description: `Created draft budget ${created.budgetNumber} (${created.name}) for FY${created.fiscalYear}`,
      newValue: {
        budgetNumber: created.budgetNumber,
        name: created.name,
        fiscalYear: created.fiscalYear,
        startDate: created.startDate,
        endDate: created.endDate,
        status: created.status,
      },
    });

    return ok(created, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest(
        "A race condition occurred while assigning the budget number. Please retry.",
      );
    }
    throw err;
  }
}
