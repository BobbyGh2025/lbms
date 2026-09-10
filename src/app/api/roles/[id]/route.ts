// ============================================================================
// LBMS Roles API — single-record endpoints
// ----------------------------------------------------------------------------
// GET    /api/roles/:id   — fetch one role with full permission list
// PATCH  /api/roles/:id   — update display name / description
// DELETE /api/roles/:id   — delete a non-system role (blocks if users assigned)
// ----------------------------------------------------------------------------
// System roles cannot be deleted. Role `name` is immutable on system roles
// (and PATCH only touches displayName + description in any case — `name`
// cannot be changed via this endpoint at all).
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { invalidateAllPermissionCaches } from "@/lib/permissions";
import {
  authorize,
  badRequest,
  notDeleted,
  notFound,
  ok,
  auditFromCtx,
} from "@/lib/api-helpers";

type RouteContext = { params: Promise<{ id: string }> };

async function loadRole(id: string) {
  return db.role.findFirst({
    where: { id, ...notDeleted() },
    include: {
      permissions: {
        include: {
          permission: { select: { id: true, module: true, action: true } },
        },
      },
      _count: { select: { users: true } },
    },
  });
}

function serializeRole(role: Awaited<ReturnType<typeof loadRole>>) {
  if (!role) return null;
  return {
    id: role.id,
    name: role.name,
    displayName: role.displayName,
    description: role.description,
    isSystem: role.isSystem,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
    permissions: role.permissions.map((rp) => ({
      id: rp.permission.id,
      module: rp.permission.module,
      action: rp.permission.action,
    })),
    _count: { users: role._count.users },
  };
}

// ---------------------------------------------------------------------------
// GET /api/roles/:id
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const auth = await authorize("roles", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const role = await loadRole(id);
  if (!role) return notFound("Role not found.");

  return ok(serializeRole(role));
}

// ---------------------------------------------------------------------------
// PATCH /api/roles/:id   { displayName?, description? }
// ---------------------------------------------------------------------------
const PatchRoleSchema = z
  .object({
    displayName: z.string().min(2).trim().optional(),
    description: z.string().trim().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Provide at least one field to update.",
  });

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const auth = await authorize("roles", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await loadRole(id);
  if (!existing) return notFound("Role not found.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }
  const parsed = PatchRoleSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return badRequest(first?.message ?? "Invalid request body.", parsed.error.issues);
  }

  const data: { displayName?: string; description?: string | null } = {};
  if (parsed.data.displayName !== undefined) {
    data.displayName = parsed.data.displayName;
  }
  if (parsed.data.description !== undefined) {
    data.description = parsed.data.description === "" ? null : parsed.data.description;
  }

  const previous = {
    name: existing.name,
    displayName: existing.displayName,
    description: existing.description,
  };

  const updated = await db.role.update({
    where: { id },
    data,
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "roles",
    recordId: id,
    recordType: "Role",
    description: `Updated role '${updated.displayName}' (${updated.name}) details.`,
    previousValue: previous,
    newValue: data,
  });

  const refreshed = await loadRole(id);
  return ok(serializeRole(refreshed));
}

// ---------------------------------------------------------------------------
// DELETE /api/roles/:id   — hard delete (cascade removes RolePermission + UserRole rows)
// ---------------------------------------------------------------------------
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const auth = await authorize("roles", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const role = await db.role.findUnique({
    where: { id },
    include: { _count: { select: { users: true } } },
  });
  if (!role || role.deletedAt) return notFound("Role not found.");

  if (role.isSystem) {
    return badRequest("System roles cannot be deleted.");
  }
  if (role._count.users > 0) {
    return badRequest(
      `Role has ${role._count.users} user(s) assigned; reassign them first.`,
    );
  }

  // Hard delete — schema cascades RolePermission + UserRole rows.
  // (Safe because we've just verified no users are assigned.)
  await db.role.delete({ where: { id } });

  // Defensive: invalidate all cached permissions (no users should be affected
  // due to the assignment guard above, but this protects against races).
  invalidateAllPermissionCaches();

  await auditFromCtx(auth.ctx, {
    action: "delete",
    module: "roles",
    recordId: id,
    recordType: "Role",
    description: `Deleted role '${role.displayName}' (${role.name}).`,
    previousValue: {
      name: role.name,
      displayName: role.displayName,
      description: role.description,
      isSystem: role.isSystem,
    },
  });

  return ok({ id, deleted: true });
}
