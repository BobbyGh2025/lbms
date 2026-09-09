// ============================================================================
// LBMS Position Detail API
// ----------------------------------------------------------------------------
// GET    /api/positions/[id]   fetch single position (departments:view)
// PATCH  /api/positions/[id]   update position (departments:edit)
// DELETE /api/positions/[id]   soft-delete position (departments:delete)
//                               blocks when active employees attached
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

  const position = await db.position.findFirst({
    where: { id, ...notDeleted() },
    include: {
      department: { select: { id: true, name: true, code: true } },
      _count: {
        select: { employees: { where: { deletedAt: null } } },
      },
    },
  });

  if (!position) return notFound("Position not found.");

  return ok(position);
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("departments", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: {
    title?: unknown;
    departmentId?: unknown;
    description?: unknown;
    status?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const existing = await db.position.findFirst({
    where: { id, ...notDeleted() },
    include: { department: { select: { name: true } } },
  });
  if (!existing) return notFound("Position not found.");

  const data: {
    title?: string;
    departmentId?: string | null;
    description?: string | null;
    status?: string;
  } = {};

  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) return badRequest("Position title cannot be empty.");
    if (title.length > 100)
      return badRequest("Position title is too long (max 100 characters).");
    if (title !== existing.title) {
      const dup = await db.position.findFirst({
        where: { title, ...notDeleted(), NOT: { id } },
        select: { id: true },
      });
      if (dup) return badRequest("A position with this title already exists.");
    }
    data.title = title;
  }

  if (body.departmentId !== undefined) {
    if (body.departmentId === null || (typeof body.departmentId === "string" && !body.departmentId.trim())) {
      if (existing.departmentId) data.departmentId = null;
    } else if (typeof body.departmentId === "string") {
      const departmentId = body.departmentId.trim();
      if (departmentId !== existing.departmentId) {
        const dept = await db.department.findFirst({
          where: { id: departmentId, ...notDeleted() },
          select: { id: true, name: true },
        });
        if (!dept)
          return badRequest("Selected department does not exist.");
      }
      data.departmentId = departmentId;
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

  const updated = await db.position.update({
    where: { id },
    data,
    include: { department: { select: { name: true, code: true } } },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "departments",
    recordId: updated.id,
    recordType: "Position",
    description: `Updated position "${updated.title}"`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("departments", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const existing = await db.position.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Position not found.");

  // Block delete if there are active employees attached to this position.
  const activeEmployees = await db.employee.count({
    where: { positionId: id, deletedAt: null },
  });

  if (activeEmployees > 0) {
    return badRequest(
      "Cannot delete a position that still has active employees. Reassign those employees first.",
      { activeEmployees },
    );
  }

  const updated = await db.position.update({
    where: { id },
    data: { deletedAt: new Date(), status: "inactive" },
  });

  await auditFromCtx(auth.ctx, {
    action: "delete",
    module: "departments",
    recordId: updated.id,
    recordType: "Position",
    description: `Deleted position "${updated.title}"`,
    previousValue: existing,
  });

  return ok({ id: updated.id, deleted: true });
}
