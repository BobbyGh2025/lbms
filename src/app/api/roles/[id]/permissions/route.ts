// ============================================================================
// LBMS Roles API — permission assignments
// ----------------------------------------------------------------------------
// GET /api/roles/:id/permissions   — list role's permission keys ["module:action", ...]
// PUT /api/roles/:id/permissions   — replace the role's entire permission set
// ----------------------------------------------------------------------------
// PUT body: { permissionKeys: string[] }
// Replacement is atomic (transaction). Unknown keys are ignored gracefully
// (logged) so out-of-date clients don't crash writes.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize,
  badRequest,
  notDeleted,
  notFound,
  ok,
  auditFromCtx,
} from "@/lib/api-helpers";
import { PERMISSION_ACTIONS, PERMISSION_MODULES } from "@/lib/permissions";

type RouteContext = { params: Promise<{ id: string }> };

const VALID_KEYS: Set<string> = new Set(
  PERMISSION_MODULES.flatMap((m) =>
    PERMISSION_ACTIONS.map((a) => `${m}:${a}`),
  ),
);

async function loadRole(id: string) {
  return db.role.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, name: true, displayName: true, isSystem: true },
  });
}

// ---------------------------------------------------------------------------
// GET /api/roles/:id/permissions
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const auth = await authorize("roles", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const role = await loadRole(id);
  if (!role) return notFound("Role not found.");

  const perms = await db.rolePermission.findMany({
    where: { roleId: id },
    select: {
      permission: { select: { module: true, action: true } },
    },
  });

  const permissionKeys = perms.map(
    (rp) => `${rp.permission.module}:${rp.permission.action}`,
  );

  return ok({ permissionKeys });
}

// ---------------------------------------------------------------------------
// PUT /api/roles/:id/permissions   { permissionKeys: string[] }
// ---------------------------------------------------------------------------
const ReplacePermissionsSchema = z.object({
  permissionKeys: z.array(z.string()).default([]),
});

export async function PUT(req: NextRequest, { params }: RouteContext) {
  const auth = await authorize("roles", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const role = await loadRole(id);
  if (!role) return notFound("Role not found.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }
  const parsed = ReplacePermissionsSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return badRequest(first?.message ?? "Invalid request body.", parsed.error.issues);
  }
  const rawKeys = parsed.data.permissionKeys;

  // Validate each key against the canonical catalogue.
  const accepted: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const key of rawKeys) {
    if (!seen.has(key)) {
      seen.add(key);
      if (VALID_KEYS.has(key)) accepted.push(key);
      else skipped.push(key);
    }
  }
  if (skipped.length > 0) {
    console.warn(
      `[roles] Ignoring unknown permission keys while updating role '${role.name}':`,
      skipped,
    );
  }

  // Resolve permission keys → IDs
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

  // Capture previous state for audit
  const previous = await db.rolePermission.findMany({
    where: { roleId: id },
    select: {
      permission: { select: { module: true, action: true } },
    },
  });
  const previousKeys = previous.map(
    (rp) => `${rp.permission.module}:${rp.permission.action}`,
  );

  // Replace within a transaction.
  await db.$transaction([
    db.rolePermission.deleteMany({ where: { roleId: id } }),
    ...(permIds.length
      ? [
          db.rolePermission.createMany({
            data: permIds.map((permissionId) => ({
              roleId: id,
              permissionId,
              assignedById: auth.ctx.userId,
            })),
          }),
        ]
      : []),
  ]);

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "roles",
    recordId: id,
    recordType: "RolePermission",
    description: `Updated permissions for role '${role.displayName}'. ${permIds.length} permission(s) assigned.`,
    previousValue: { permissionKeys: previousKeys },
    newValue: { permissionKeys: accepted, skippedCount: skipped.length },
  });

  return ok({
    permissionKeys: accepted,
    skippedCount: skipped.length,
  });
}
