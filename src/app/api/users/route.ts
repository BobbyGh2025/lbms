// ============================================================================
// LBMS Users API — collection endpoints
// ----------------------------------------------------------------------------
// GET  /api/users              — paginated list (search + status filter)
// POST /api/users              — create a new user (email + username unique)
// ----------------------------------------------------------------------------
// All responses exclude `passwordHash`. Soft-delete is honoured: only users
// where `deletedAt IS NULL` are returned by GET; POST always creates active.
// ============================================================================

import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize,
  badRequest,
  notDeleted,
  ok,
  pagination,
  auditFromCtx,
} from "@/lib/api-helpers";

// ---------------------------------------------------------------------------
// Shared projection — never include passwordHash
// ---------------------------------------------------------------------------
const USER_SELECT = {
  id: true,
  email: true,
  username: true,
  status: true,
  lastLoginAt: true,
  lastLoginIp: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
  employee: {
    select: { id: true, employeeId: true, fullName: true },
  },
  userRoles: {
    select: {
      role: { select: { id: true, name: true, displayName: true } },
    },
  },
} as const;

function serialize(user: any) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    status: user.status,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    lastLoginIp: user.lastLoginIp ?? null,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    employee: user.employee
      ? {
          id: user.employee.id,
          employeeId: user.employee.employeeId,
          fullName: user.employee.fullName,
        }
      : null,
    roles: (user.userRoles ?? []).map((ur: any) => ({
      id: ur.role.id,
      name: ur.role.name,
      displayName: ur.role.displayName,
    })),
  };
}

// ---------------------------------------------------------------------------
// GET /api/users?page=&pageSize=&search=&status=
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("users", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const { page, pageSize, search, status, skip } = pagination(sp);

  const where: any = { ...notDeleted() };
  if (status && status !== "all") where.status = status;
  if (search) {
    where.OR = [
      { email: { contains: search } },
      { username: { contains: search } },
    ];
  }

  const [total, rows] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
  ]);

  return ok({
    items: rows.map(serialize),
    total,
    page,
    pageSize,
  });
}

// ---------------------------------------------------------------------------
// POST /api/users
// ---------------------------------------------------------------------------
const CreateUserSchema = z.object({
  email: z.string().email("A valid email is required."),
  username: z.string().min(3, "Username must be at least 3 characters."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  employeeId: z.string().nullable().optional(),
  roleIds: z.array(z.string()).default([]),
  status: z.enum(["active", "inactive", "suspended"]).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("users", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateUserSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return badRequest(first?.message ?? "Invalid request body.", parsed.error.issues);
  }
  const data = parsed.data;

  // Normalise email
  const email = data.email.trim().toLowerCase();
  const username = data.username.trim();

  // Uniqueness checks (account for soft-deleted rows: a soft-deleted email
  // still occupies the unique constraint in SQLite, so we surface a friendly
  // message instead of leaking a Prisma error).
  const [existingEmail, existingUsername] = await Promise.all([
    db.user.findUnique({ where: { email }, select: { id: true, deletedAt: true } }),
    db.user.findUnique({ where: { username }, select: { id: true, deletedAt: true } }),
  ]);
  if (existingEmail) {
    return badRequest(
      existingEmail.deletedAt
        ? "A deleted account with this email already exists. Restore it before reusing the email."
        : "An account with this email already exists.",
    );
  }
  if (existingUsername) {
    return badRequest(
      existingUsername.deletedAt
        ? "A deleted account with this username already exists. Choose a different username."
        : "This username is already taken.",
    );
  }

  // Validate roleIds exist + employee is unlinked (if provided)
  if (data.roleIds.length) {
    const validRoles = await db.role.findMany({
      where: { id: { in: data.roleIds }, deletedAt: null },
      select: { id: true },
    });
    if (validRoles.length !== data.roleIds.length) {
      return badRequest("One or more selected roles are invalid.");
    }
  }
  if (data.employeeId) {
    // Employee → User link is stored on User.employeeId (one-to-one).
    // Detect an existing link by querying User rows for that employeeId.
    const [emp, linkedUser] = await Promise.all([
      db.employee.findUnique({
        where: { id: data.employeeId },
        select: { id: true, deletedAt: true },
      }),
      db.user.findFirst({
        where: { employeeId: data.employeeId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!emp || emp.deletedAt) {
      return badRequest("The selected employee profile was not found.");
    }
    if (linkedUser) {
      return badRequest("That employee is already linked to another user account.");
    }
  }

  const passwordHash = await bcrypt.hash(data.password, 10);

  // Create user + roles in a transaction. The User.employeeId FK establishes
  // the one-to-one link to Employee automatically — no separate update needed.
  const created = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        username,
        passwordHash,
        status: data.status ?? "active",
        employeeId: data.employeeId ?? null,
        createdById: auth.ctx.userId,
        ...(data.roleIds.length
          ? {
              userRoles: {
                create: data.roleIds.map((roleId) => ({
                  roleId,
                  assignedById: auth.ctx.userId,
                })),
              },
            }
          : {}),
      },
      select: USER_SELECT,
    });

    return user;
  });

  await auditFromCtx(auth.ctx, {
    action: "create",
    module: "users",
    recordId: created.id,
    recordType: "User",
    description: `Created user ${created.username} (${created.email})`,
    newValue: serialize(created),
  });

  return ok(serialize(created), 201);
}
