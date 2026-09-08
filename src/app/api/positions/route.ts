// ============================================================================
// LBMS Positions API
// ----------------------------------------------------------------------------
// GET  /api/positions            list active positions, optional ?departmentId
//                                filter (departments:view)
// POST /api/positions            create position (departments:create)
// ----------------------------------------------------------------------------
// Positions are managed under the "departments" permission namespace.
// Audit entries use recordType "Position" but module "departments" so the
// department activity feed stays coherent.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
  badRequest,
  auditFromCtx,
  notDeleted,
} from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const auth = await authorize("departments", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const departmentId = sp.get("departmentId")?.trim() || undefined;
  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;

  const items = await db.position.findMany({
    where: {
      ...notDeleted(),
      ...(departmentId ? { departmentId } : {}),
      ...(search ? { title: { contains: search } } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: [{ title: "asc" }],
    include: {
      department: { select: { name: true, code: true } },
      _count: {
        select: { employees: { where: { deletedAt: null } } },
      },
    },
  });

  return ok({ items });
}

export async function POST(req: NextRequest) {
  const auth = await authorize("departments", "create");
  if (!auth.ok) return auth.response;

  let body: {
    title?: unknown;
    departmentId?: unknown;
    description?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return badRequest("Position title is required.");
  if (title.length > 100)
    return badRequest("Position title is too long (max 100 characters).");

  const departmentId =
    typeof body.departmentId === "string" && body.departmentId.trim()
      ? body.departmentId.trim()
      : null;

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : undefined;

  // Validate title uniqueness (case-insensitive on SQLite falls back to value match)
  const existingTitle = await db.position.findFirst({
    where: { title, ...notDeleted() },
    select: { id: true },
  });
  if (existingTitle)
    return badRequest("A position with this title already exists.");

  // Validate departmentId points to an active department
  if (departmentId) {
    const dept = await db.department.findFirst({
      where: { id: departmentId, ...notDeleted() },
      select: { id: true, name: true },
    });
    if (!dept)
      return badRequest("Selected department does not exist.");
  }

  const created = await db.position.create({
    data: { title, departmentId, description, status: "active" },
    include: { department: { select: { name: true, code: true } } },
  });

  await auditFromCtx(auth.ctx, {
    action: "create",
    module: "departments",
    recordId: created.id,
    recordType: "Position",
    description: `Created position "${created.title}"${
      created.department ? ` in ${created.department.name}` : ""
    }`,
    newValue: created,
  });

  return ok(created, 201);
}
