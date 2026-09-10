// ============================================================================
// LBMS Phase 9 API — Operations Analytics
// GET /api/reports/management/operations?preset=month
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize, ok } from "@/lib/api-helpers";
import { parseDateRange } from "@/lib/report-utils";

export async function GET(req: NextRequest) {
  const auth = await authorize("reports", "view");
  if (!auth.ok) return auth.response;
  const range = parseDateRange(req.nextUrl.searchParams);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [statusCounts, overdueCount, dueTodayCount, tasksByProject, tasksByAssignee] = await Promise.all([
    db.task.groupBy({ by: ["status"], where: { deletedAt: null, createdAt: { gte: range.from, lte: range.to } }, _count: true }),
    db.task.count({ where: { deletedAt: null, status: { in: ["todo", "in_progress", "on_hold"] }, dueDate: { lt: now } } }),
    db.task.count({ where: { deletedAt: null, status: { in: ["todo", "in_progress", "on_hold"] }, dueDate: { gte: startOfToday, lt: new Date(startOfToday.getTime() + 86400000) } } }),
    db.task.groupBy({ by: ["projectId"], where: { deletedAt: null, createdAt: { gte: range.from, lte: range.to }, projectId: { not: null } }, _count: true, orderBy: { projectId: "asc" }, take: 100 }),
    db.task.groupBy({ by: ["assignedEmployeeId"], where: { deletedAt: null, createdAt: { gte: range.from, lte: range.to }, assignedEmployeeId: { not: null } }, _count: true, orderBy: { assignedEmployeeId: "asc" }, take: 100 }),
  ]);

  const projIds = tasksByProject.map(r => r.projectId).filter(Boolean) as string[];
  const empIds = tasksByAssignee.map(r => r.assignedEmployeeId).filter(Boolean) as string[];
  const [projects, employees] = await Promise.all([
    db.project.findMany({ where: { id: { in: projIds } }, select: { id: true, projectNumber: true, name: true } }),
    db.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, fullName: true, employeeNumber: true } }),
  ]);
  const projMap = new Map(projects.map(p => [p.id, p]));
  const empMap = new Map(employees.map(e => [e.id, e]));

  return ok({
    period: { from: range.from.toISOString(), to: range.to.toISOString(), preset: range.preset, label: range.label },
    totals: {
      tasksCreated: statusCounts.reduce((s, r) => s + r._count, 0),
      overdue: overdueCount,
      dueToday: dueTodayCount,
    },
    statusDistribution: statusCounts.map(s => ({ status: s.status, count: s._count })),
    tasksByProject: tasksByProject.map(r => {
      const p = projMap.get(r.projectId!);
      return { projectId: r.projectId, projectNumber: p?.projectNumber ?? null, name: p?.name ?? "Unknown", taskCount: r._count };
    }).sort((a, b) => b.taskCount - a.taskCount).slice(0, 10),
    tasksByAssignee: tasksByAssignee.map(r => {
      const e = empMap.get(r.assignedEmployeeId!);
      return { employeeId: r.assignedEmployeeId, name: e?.fullName ?? "Unknown", employeeNumber: e?.employeeNumber ?? null, taskCount: r._count };
    }).sort((a, b) => b.taskCount - a.taskCount).slice(0, 10),
  });
}
