// ============================================================================
// LBMS Staff API — Performance reviews collection
// ----------------------------------------------------------------------------
// GET  /api/staff/performance   paginated list with filters (employeeId,
//                               status). performance:view.
// POST /api/staff/performance   create a performance review. Validates: valid
//                               employee + valid reviewer (user ID).
//                               performance:create. Audit recorded.
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

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/staff/performance
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("performance", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const employeeId = sp.get("employeeId")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;

  const where: Record<string, unknown> = {};
  if (employeeId) where.employeeId = employeeId;
  if (status) where.status = status;

  const [total, items] = await Promise.all([
    db.employeePerformanceReview.count({ where }),
    db.employeePerformanceReview.findMany({
      where,
      orderBy: { reviewDate: "desc" },
      skip,
      take: pageSize,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            employeeNumber: true,
            department: { select: { id: true, name: true } },
            position: { select: { id: true, title: true } },
          },
        },
      },
    }),
  ]);

  return ok({
    items,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

// ---------------------------------------------------------------------------
// POST /api/staff/performance
// ---------------------------------------------------------------------------
const CreateReviewSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  reviewPeriod: z
    .string()
    .min(1, "Review period is required (e.g. 2026-Q1, 2026-Annual)")
    .max(50),
  reviewDate: dateString,
  reviewerId: z.string().min(1, "Reviewer user ID is required"),
  rating: z.string().max(50).optional(),
  strengths: z.string().max(5000).optional(),
  improvementAreas: z.string().max(5000).optional(),
  objectives: z.string().max(5000).optional(),
  comments: z.string().max(5000).optional(),
  status: z.enum(["draft", "completed"]).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("performance", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateReviewSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Validate employee
  const employee = await db.employee.findFirst({
    where: { id: d.employeeId, ...notDeleted() },
    select: { id: true, fullName: true, employeeId: true },
  });
  if (!employee) return badRequest("Selected employee does not exist or is inactive.");

  // Validate reviewer (must be an existing user)
  const reviewer = await db.user.findUnique({
    where: { id: d.reviewerId },
    select: { id: true, username: true, status: true },
  });
  if (!reviewer) return badRequest("Selected reviewer (user) does not exist.");
  if (reviewer.status !== "active") {
    return badRequest("Selected reviewer account is not active.");
  }

  const created = await db.employeePerformanceReview.create({
    data: {
      employeeId: d.employeeId,
      reviewPeriod: d.reviewPeriod.trim(),
      reviewDate: new Date(d.reviewDate),
      reviewerId: d.reviewerId,
      rating: d.rating?.trim() || null,
      strengths: d.strengths?.trim() || null,
      improvementAreas: d.improvementAreas?.trim() || null,
      objectives: d.objectives?.trim() || null,
      comments: d.comments?.trim() || null,
      status: d.status ?? "draft",
    },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          employeeId: true,
          employeeNumber: true,
        },
      },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "create",
    module: "performance",
    recordId: created.id,
    recordType: "EmployeePerformanceReview",
    description: `Created performance review for ${created.employee.fullName} (${created.employee.employeeId}) — period ${created.reviewPeriod}`,
    newValue: created,
  });

  return ok(created, 201);
}
