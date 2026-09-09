// ============================================================================
// LBMS Staff API — Performance review detail
// ----------------------------------------------------------------------------
// GET   /api/staff/performance/[id]   single performance review. performance:view.
// PATCH /api/staff/performance/[id]   update review fields (reviewerId, rating,
//                                     strengths, improvementAreas, objectives,
//                                     comments, status, reviewDate,
//                                     reviewPeriod). performance:edit. Audit
//                                     records previousValue + newValue.
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
} from "@/lib/api-helpers";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/staff/performance/[id]
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("performance", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const review = await db.employeePerformanceReview.findUnique({
    where: { id },
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
  });

  if (!review) return notFound("Performance review not found.");

  return ok(review);
}

// ---------------------------------------------------------------------------
// PATCH /api/staff/performance/[id]
// ---------------------------------------------------------------------------
const UpdateReviewSchema = z.object({
  reviewPeriod: z.string().min(1).max(50).optional(),
  reviewDate: dateString.optional(),
  reviewerId: z.string().min(1).optional(),
  rating: z.string().max(50).nullable().optional(),
  strengths: z.string().max(5000).nullable().optional(),
  improvementAreas: z.string().max(5000).nullable().optional(),
  objectives: z.string().max(5000).nullable().optional(),
  comments: z.string().max(5000).nullable().optional(),
  status: z.enum(["draft", "completed"]).optional(),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("performance", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = UpdateReviewSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  const existing = await db.employeePerformanceReview.findUnique({
    where: { id },
  });
  if (!existing) return notFound("Performance review not found.");

  const data: Record<string, unknown> = {};

  if (d.reviewPeriod !== undefined) data.reviewPeriod = d.reviewPeriod.trim();
  if (d.reviewDate !== undefined) data.reviewDate = new Date(d.reviewDate);
  if (d.reviewerId !== undefined) {
    // Validate reviewer when changing
    if (d.reviewerId !== existing.reviewerId) {
      const reviewer = await db.user.findUnique({
        where: { id: d.reviewerId },
        select: { id: true, status: true },
      });
      if (!reviewer) return badRequest("Selected reviewer (user) does not exist.");
      if (reviewer.status !== "active") {
        return badRequest("Selected reviewer account is not active.");
      }
    }
    data.reviewerId = d.reviewerId;
  }
  if (d.rating !== undefined) data.rating = d.rating?.trim() || null;
  if (d.strengths !== undefined) data.strengths = d.strengths?.trim() || null;
  if (d.improvementAreas !== undefined) data.improvementAreas = d.improvementAreas?.trim() || null;
  if (d.objectives !== undefined) data.objectives = d.objectives?.trim() || null;
  if (d.comments !== undefined) data.comments = d.comments?.trim() || null;
  if (d.status !== undefined) data.status = d.status;

  if (Object.keys(data).length === 0) {
    return badRequest("No fields provided to update.");
  }

  const updated = await db.employeePerformanceReview.update({
    where: { id },
    data,
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
    action: "update",
    module: "performance",
    recordId: updated.id,
    recordType: "EmployeePerformanceReview",
    description: `Updated performance review for ${updated.employee.fullName} (${updated.employee.employeeId}) — period ${updated.reviewPeriod}`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
