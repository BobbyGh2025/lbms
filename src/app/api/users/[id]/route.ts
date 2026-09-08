// ============================================================================
// LBMS Users API — single-record endpoints
// ----------------------------------------------------------------------------
// GET    /api/users/:id   — fetch one user (with roles + employee)
// PATCH  /api/users/:id   — update fields (email, username, status, employeeId, password)
// DELETE /api/users/:id   — soft-delete (set deletedAt)
// ----------------------------------------------------------------------------
// `passwordHash` is never returned. Soft-deleted users (deletedAt != null)
// are treated as 404 by GET / PATCH / DELETE.
// ============================================================================

import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize,
  badRequest,
  forbidden,
  notDeleted,
  notFound,
  ok,
  auditFromCtx,
} from "@/lib/api-helpers";

const USER_SELECT = {
  id: true,
  email: true,
  username: true,
  status: true,
  lastLoginAt: true,
  lastLoginIp: true,
  mustChangePassword: true,
  employeeId: true,
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
    employeeId: user.employeeId ?? null,
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
// Helpers
// ---------------------------------------------------------------------------
async function loadUser(id: string) {
  return db.user.findFirst({
    where: { id, ...notDeleted() },
    select: USER_SELECT,
  });
}

async function isMDUser(userId: string): Promise<boolean> {
  // Check direct md role assignment via UserRole → Role.name = "md".
  const mdLink = await db.userRole.findFirst({
    where: {
      userId,
      role: { name: "md", deletedAt: null },
    },
    select: { roleId: true },
  });
  return !!mdLink;
}

async function countMDUsers(excludeId?: string): Promise<number> {
  return db.userRole.count({
    where: {
      role: { name: "md", deletedAt: null },
      user: { deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/users/:id
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("users", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const user = await loadUser(id);
  if (!user) return notFound("User not found.");
  return ok(serialize(user));
}

// ---------------------------------------------------------------------------
// PATCH /api/users/:id
// ---------------------------------------------------------------------------
const PatchUserSchema = z
  .object({
    email: z.string().email().optional(),
    username: z.string().min(3).optional(),
    status: z.enum(["active", "inactive", "suspended"]).optional(),
    employeeId: z.string().nullable().optional(),
    password: z.string().min(8).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Provide at least one field to update.",
  });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("users", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await loadUser(id);
  if (!existing) return notFound("User not found.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }
  const parsed = PatchUserSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return badRequest(first?.message ?? "Invalid request body.", parsed.error.issues);
  }
  const data = parsed.data;

  // Uniqueness checks for email / username (ignore the row itself)
  if (data.email) {
    const normalized = data.email.trim().toLowerCase();
    data.email = normalized;
    const clash = await db.user.findFirst({
      where: { email: normalized, id: { not: id }, deletedAt: null },
      select: { id: true },
    });
    if (clash) return badRequest("An account with this email already exists.");
  }
  if (data.username) {
    data.username = data.username.trim();
    const clash = await db.user.findFirst({
      where: { username: data.username, id: { not: id }, deletedAt: null },
      select: { id: true },
    });
    if (clash) return badRequest("This username is already taken.");
  }

  // Employee re-link validation
  if (data.employeeId !== undefined) {
    if (data.employeeId) {
      const [emp, linkedUser] = await Promise.all([
        db.employee.findUnique({
          where: { id: data.employeeId },
          select: { id: true, deletedAt: true },
        }),
        db.user.findFirst({
          where: { employeeId: data.employeeId, id: { not: id }, deletedAt: null },
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
  }

  // Status guard: do not allow suspending / deactivating the last MD
  if (data.status && data.status !== "active" && existing.status === "active") {
    const userIsMD = await isMDUser(id);
    if (userIsMD) {
      const mdCount = await countMDUsers(id);
      if (mdCount <= 1) {
        return badRequest(
          "Cannot deactivate or suspend the last Managing Director account.",
        );
      }
    }
  }

  const { password, ...patchData } = data;
  const updateData: any = { ...patchData };
  if (password) {
    updateData.passwordHash = await bcrypt.hash(password, 10);
  }

  const updated = await db.user.update({
    where: { id },
    data: updateData,
    select: USER_SELECT,
  });

  // Audit (exclude passwordHash entirely; previousValue + newValue are
  // already clean because we only select whitelisted fields).
  const previousValue = serialize(existing);
  const newValue = serialize(updated);
  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "users",
    recordId: id,
    recordType: "User",
    description: `Updated user ${updated.username} (${updated.email})${
      password ? " — password changed" : ""
    }`,
    previousValue,
    newValue,
  });

  return ok(newValue);
}

// ---------------------------------------------------------------------------
// DELETE /api/users/:id  (soft-delete)
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("users", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await loadUser(id);
  if (!existing) return notFound("User not found.");

  // Prevent self-deletion
  if (auth.ctx.isMD === false && auth.ctx.userId === id) {
    return forbidden("You cannot delete your own account.");
  }
  if (auth.ctx.userId === id) {
    return forbidden("You cannot delete your own account.");
  }

  // Prevent deleting the last MD
  const userIsMD = await isMDUser(id);
  if (userIsMD) {
    const mdCount = await countMDUsers(id);
    if (mdCount <= 1) {
      return forbidden(
        "Cannot delete the last Managing Director account.",
      );
    }
  }

  const now = new Date();
  // Soft-delete the user and clear the employee link so the employee becomes
  // available to re-link to a new user (SQLite's @unique on User.employeeId
  // would otherwise block reassignment). Audit captures the previous link.
  await db.user.update({
    where: { id },
    data: {
      deletedAt: now,
      status: "inactive",
      employeeId: null,
    },
    select: { id: true },
  });

  await auditFromCtx(auth.ctx, {
    action: "delete",
    module: "users",
    recordId: id,
    recordType: "User",
    description: `Deleted user ${existing.username} (${existing.email})`,
    previousValue: serialize(existing),
  });

  return ok({ id, deletedAt: now.toISOString() });
}
