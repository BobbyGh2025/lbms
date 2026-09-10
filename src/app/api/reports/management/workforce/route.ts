// ============================================================================
// LBMS Phase 9 API — Workforce / HR Analytics
// GET /api/reports/management/workforce?preset=month
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, ok } from "@/lib/api-helpers";
import { parseDateRange, rangeWhere } from "@/lib/report-utils";

export async function GET(req: NextRequest) {
  const auth = await authorize("reports", "view");
  if (!auth.ok) return auth.response;
  const range = parseDateRange(req.nextUrl.searchParams);

  const [totalEmployees, activeEmployees, onLeave, probation, byDepartment, pendingLeave, leaveApproved, performanceReviews] = await Promise.all([
    db.employee.count({ where: { deletedAt: null } }),
    db.employee.count({ where: { deletedAt: null, status: "active" } }),
    db.employee.count({ where: { deletedAt: null, status: "on_leave" } }),
    db.employee.count({ where: { deletedAt: null, status: "probation" } }),
    db.employee.groupBy({ by: ["departmentId"], where: { deletedAt: null }, _count: true }),
    db.leaveRequest.count({ where: { status: "pending" } }),
    db.leaveRequest.count({ where: { status: "approved", ...rangeWhere(range, "createdAt") } }),
    db.employeePerformanceReview.count({ where: { ...rangeWhere(range, "createdAt") } }),
  ]);

  const deptIds = byDepartment.map(r => r.departmentId).filter(Boolean) as string[];
  const departments = await db.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true, code: true } });
  const deptMap = new Map(departments.map(d => [d.id, d]));

  return ok({
    period: { from: range.from.toISOString(), to: range.to.toISOString(), preset: range.preset, label: range.label },
    totals: {
      totalEmployees, activeEmployees, onLeave, probation,
      pendingLeaveRequests: pendingLeave,
      approvedLeaveInPeriod: leaveApproved,
      performanceReviewsInPeriod: performanceReviews,
    },
    employeesByDepartment: byDepartment.map(r => {
      const d = deptMap.get(r.departmentId!);
      return { departmentId: r.departmentId, name: d?.name ?? "Unknown", code: d?.code ?? null, employeeCount: r._count };
    }),
  });
}
