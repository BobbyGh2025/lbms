// ============================================================================
// LBMS Roles API — collection endpoints
// ----------------------------------------------------------------------------
// GET  /api/roles         — list all roles with permission + user counts
// POST /api/roles         — create a new role + initial permission set
// ----------------------------------------------------------------------------
// Permission keys are exchanged as "module:action" strings (e.g.
// "finance:view"). The Permission catalogue is canonical and lives in
// `@/lib/permissions` (PERMISSION_MODULES x PERMISSION_ACTIONS).
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize,
  badRequest,
  notDeleted,
  ok,
  auditFromCtx,
} from "@/lib/api-helpers";
import { PERMISSION_ACTIONS, PERMISSION_MODULES } from "@/lib/permissions";

// Pre-computed set of valid "module:action" keys for fast membership checks.
const VALID_KEYS: Set<string> = new Set(
  PERMISSION_MODULES.flatMap((m) =>
    PERMISSION_ACTIONS.map((a) => `${m}:${a}`),
  ),
);

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------
function serializeRole(role: {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  permissions: { permission: { id: string; module: string; action: string } }[];
  _count: { users: number };
}) {
  return {
    id: role.id,
    name: role.name,
    displayName: role.displayName,
    description: role.description,
    isSystem: role.isSystem,
    createdAt: role.createdAt.toISOString(),
    permissions: role.permissions.map((rp) => ({
      id: rp.permission.id,
      module: rp.permission.module,
      action: rp.permission.action,
    })),
    _count: { users: role._count.users },
  };
}

// ---------------------------------------------------------------------------
// GET /api/roles
// ---------------------------------------------------------------------------
export async function GET() {
  const auth = await authorize("roles", "view");
  if (!auth.ok) return auth.response;

  const roles = await db.role.findMany({
    where: notDeleted(),
    orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
    include: {
      permissions: {
        include: {
          permission: { select: { id: true, module: true, action: true } },
        },
      },
      _count: { select: { users: true } },
    },
  });

  return ok({ items: roles.map(serializeRole) });
}

// ---------------------------------------------------------------------------
// POST /api/roles   { name, displayName, description?, permissionKeys: string[] }
// ---------------------------------------------------------------------------
const CreateRoleSchema = z.object({
  name: z
    .string()
    .min(2, "Role code must be at least 2 characters.")
    .regex(/^[a-z][a-z0-9_]*$/, "Role code must be lowercase, no spaces, starting with a letter."),
  displayName: z.string().min(2, "Display name is required.").trim(),
  description: z.string().trim().optional().nullable(),
  permissionKeys: z.array(z.string()).default([]),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("roles", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }
  const parsed = CreateRoleSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return badRequest(first?.message ?? "Invalid request body.", parsed.error.issues);
  }
  const { name, displayName, description, permissionKeys } = parsed.data;

  // Validate permission keys against the canonical catalogue. Unknown keys
  // are dropped silently (we still log them so admins can investigate).
  const accepted: string[] = [];
  const skipped: string[] = [];
  for (const key of permissionKeys) {
    if (VALID_KEYS.has(key)) accepted.push(key);
    else skipped.push(key);
  }
  if (skipped.length > 0) {
    console.warn(
      `[roles] Ignoring unknown permission keys while creating role '${name}':`,
      skipped,
    );
  }

  // Uniqueness check (across all roles, including soft-deleted — unique name
  // constraint would otherwise throw a Prisma error which we want to avoid).
  const existing = await db.role.findUnique({
    where: { name },
    select: { id: true, deletedAt: true },
  });
  if (existing && !existing.deletedAt) {
    return badRequest(`A role with code '${name}' already exists.`);
  }

  // Resolve permission keys → Permission IDs
  const perms = await db.permission.findMany({
    where: {
      OR: accepted.map((k) => {
        const [module, action] = k.split(":");
        return { module, action };
      }),
    },
    select: { id: true, module: true, action: true },
  });
  const keyToId = new Map(perms.map((p) => [`${p.module}:${p.action}`, p.id]));
  const permIds = accepted
    .map((k) => keyToId.get(k))
    .filter((x): x is string => !!x);

  // If a soft-deleted role with the same name exists, restore it instead of
  // failing the unique constraint. We reuse the row and reset its fields.
  if (existing && existing.deletedAt) {
    const restored = await db.role.update({
      where: { id: existing.id },
      data: {
        name,
        displayName,
        description: description ?? null,
        isSystem: false,
        deletedAt: null,
        createdById: auth.ctx.userId,
      },
      include: {
        permissions: {
          include: {
            permission: { select: { id: true, module: true, action: true } },
          },
        },
        _count: { select: { users: true } },
      },
    });
    // Replace permissions
    await db.$transaction([
      db.rolePermission.deleteMany({ where: { roleId: restored.id } }),
      ...(permIds.length
        ? [
            db.rolePermission.createMany({
              data: permIds.map((permissionId) => ({
                roleId: restored.id,
                permissionId,
                assignedById: auth.ctx.userId,
              })),
            }),
          ]
        : []),
    ]);

    const fresh = await db.role.findUnique({
      where: { id: restored.id },
      include: {
        permissions: {
          include: {
            permission: { select: { id: true, module: true, action: true } },
          },
        },
        _count: { select: { users: true } },
      },
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "roles",
      recordId: restored.id,
      recordType: "Role",
      description: `Re-created role '${restored.displayName}' (${restored.name}) with ${permIds.length} permission(s).`,
      newValue: {
        name,
        displayName,
        description,
        permissionKeys: accepted,
        restoredFromDeletedAt: existing.deletedAt.toISOString(),
      },
    });

    return ok(serializeRole(fresh!), 201);
  }

  // Standard create path
  const role = await db.role.create({
    data: {
      name,
      displayName,
      description: description ?? null,
      createdById: auth.ctx.userId,
      permissions: {
        create: permIds.map((permissionId) => ({
          permissionId,
          assignedById: auth.ctx.userId,
        })),
      },
    },
    include: {
      permissions: {
        include: {
          permission: { select: { id: true, module: true, action: true } },
        },
      },
      _count: { select: { users: true } },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "create",
    module: "roles",
    recordId: role.id,
    recordType: "Role",
    description: `Created role '${role.displayName}' (${role.name}) with ${permIds.length} permission(s).`,
    newValue: { name, displayName, description, permissionKeys: accepted },
  });

  return ok(serializeRole(role), 201);
}
