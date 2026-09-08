// ============================================================================
// LBMS Departments API
// ----------------------------------------------------------------------------
// GET  /api/departments          list active departments with position +
//                                employee counts (departments:view)
// POST /api/departments          create department (departments:create)
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
  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;

  const where = {
    ...notDeleted(),
    ...(search ? { name: { contains: search } } : {}),
    ...(status ? { status } : {}),
  };

  const items = await db.department.findMany({
    where,
    orderBy: [{ name: "asc" }],
    include: {
      _count: {
        select: {
          positions: { where: { deletedAt: null } },
          employees: { where: { deletedAt: null } },
        },
      },
    },
  });

  return ok({ items });
}

export async function POST(req: NextRequest) {
  const auth = await authorize("departments", "create");
  if (!auth.ok) return auth.response;

  let body: {
    name?: unknown;
    code?: unknown;
    description?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return badRequest("Department name is required.");
  if (name.length > 100)
    return badRequest("Department name is too long (max 100 characters).");

  const code =
    typeof body.code === "string" && body.code.trim()
      ? body.code.trim().toUpperCase()
      : undefined;
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : undefined;

  // Name uniqueness (against non-deleted records)
  const existingName = await db.department.findFirst({
    where: { name, ...notDeleted() },
    select: { id: true },
  });
  if (existingName)
    return badRequest("A department with this name already exists.");

  // Code uniqueness (when provided)
  if (code) {
    const existingCode = await db.department.findFirst({
      where: { code, ...notDeleted() },
      select: { id: true },
    });
    if (existingCode)
      return badRequest("A department with this code already exists.");
  }

  const created = await db.department.create({
    data: { name, code, description, status: "active" },
  });

  await auditFromCtx(auth.ctx, {
    action: "create",
    module: "departments",
    recordId: created.id,
    recordType: "Department",
    description: `Created department "${created.name}"`,
    newValue: created,
  });

  return ok(created, 201);
}
