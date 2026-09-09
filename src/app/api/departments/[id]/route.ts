// ============================================================================
// LBMS Department Detail API
// ----------------------------------------------------------------------------
// GET    /api/departments/[id]   fetch single department + its positions
//                                (departments:view)
// PATCH  /api/departments/[id]   update department (departments:edit)
// DELETE /api/departments/[id]   soft-delete department (departments:delete)
//                                 blocks when active employees or positions
// ============================================================================

import { NextRequest } from "next/server";
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

const STATUS_VALUES = new Set(["active", "inactive"]);

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("departments", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const dept = await db.department.findFirst({
    where: { id, ...notDeleted() },
    include: {
      positions: {
        where: { deletedAt: null },
        orderBy: { title: "asc" },
        include: {
          _count: {
            select: { employees: { where: { deletedAt: null } } },
          },
        },
      },
      _count: {
        select: {
          employees: { where: { deletedAt: null } },
          positions: { where: { deletedAt: null } },
        },
      },
    },
  });

  if (!dept) return notFound("Department not found.");

  return ok(dept);
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("departments", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: {
    name?: unknown;
    code?: unknown;
    description?: unknown;
    status?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const existing = await db.department.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Department not found.");

  const data: {
    name?: string;
    code?: string | null;
    description?: string | null;
    status?: string;
  } = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return badRequest("Department name cannot be empty.");
    if (name.length > 100)
      return badRequest("Department name is too long (max 100 characters).");
    if (name !== existing.name) {
      const dup = await db.department.findFirst({
        where: { name, ...notDeleted(), NOT: { id } },
        select: { id: true },
      });
      if (dup) return badRequest("A department with this name already exists.");
    }
    data.name = name;
  }

  if (body.code !== undefined) {
    if (body.code === null || (typeof body.code === "string" && !body.code.trim())) {
      if (existing.code) data.code = null;
    } else if (typeof body.code === "string") {
      const code = body.code.trim().toUpperCase();
      if (code !== existing.code) {
        const dup = await db.department.findFirst({
          where: { code, ...notDeleted(), NOT: { id } },
          select: { id: true },
        });
        if (dup) return badRequest("A department with this code already exists.");
      }
      data.code = code;
    }
  }

  if (body.description !== undefined) {
    if (body.description === null) {
      data.description = null;
    } else if (typeof body.description === "string") {
      data.description = body.description.trim() || null;
    }
  }

  if (typeof body.status === "string") {
    const status = body.status.trim();
    if (!STATUS_VALUES.has(status))
      return badRequest("Status must be 'active' or 'inactive'.");
    if (status !== existing.status) data.status = status;
  }

  if (Object.keys(data).length === 0)
    return badRequest("No fields provided to update.");

  const updated = await db.department.update({
    where: { id },
    data,
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "departments",
    recordId: updated.id,
    recordType: "Department",
    description: `Updated department "${updated.name}"`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("departments", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const existing = await db.department.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Department not found.");

  // Block delete if there are active employees or active positions.
  const [activeEmployees, activePositions] = await Promise.all([
    db.employee.count({
      where: { departmentId: id, deletedAt: null },
    }),
    db.position.count({
      where: { departmentId: id, deletedAt: null },
    }),
  ]);

  if (activeEmployees > 0 || activePositions > 0) {
    return badRequest(
      "Cannot delete a department that still has active employees or positions. Reassign or remove them first.",
      { activeEmployees, activePositions },
    );
  }

  const updated = await db.department.update({
    where: { id },
    data: { deletedAt: new Date(), status: "inactive" },
  });

  await auditFromCtx(auth.ctx, {
    action: "delete",
    module: "departments",
    recordId: updated.id,
    recordType: "Department",
    description: `Deleted department "${updated.name}"`,
    previousValue: existing,
  });

  return ok({ id: updated.id, deleted: true });
}
