// ============================================================================
// LBMS Users API — role assignments for a single user
// ----------------------------------------------------------------------------
// GET /api/users/:id/roles    — list the user's current role assignments
// PUT /api/users/:id/roles   — replace the user's roles with the provided set
// ----------------------------------------------------------------------------
// Replaces all existing UserRole rows for the user. Audit logged.
// ============================================================================

import { NextRequest } from "next/server";
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

async function loadUser(id: string) {
  return db.user.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, username: true, email: true },
  });
}

// ---------------------------------------------------------------------------
// GET /api/users/:id/roles
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

  const assignments = await db.userRole.findMany({
    where: { userId: id },
    select: {
      role: { select: { id: true, name: true, displayName: true, isSystem: true } },
      assignedAt: true,
    },
    orderBy: { assignedAt: "asc" },
  });

  return ok({
    items: assignments.map((a) => ({
      id: a.role.id,
      name: a.role.name,
      displayName: a.role.displayName,
      isSystem: a.role.isSystem,
      assignedAt: a.assignedAt.toISOString(),
    })),
  });
}

// ---------------------------------------------------------------------------
// PUT /api/users/:id/roles   { roleIds: string[] }
// ---------------------------------------------------------------------------
const ReplaceRolesSchema = z.object({
  roleIds: z.array(z.string()).default([]),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("users", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const user = await loadUser(id);
  if (!user) return notFound("User not found.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }
  const parsed = ReplaceRolesSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return badRequest(first?.message ?? "Invalid request body.", parsed.error.issues);
  }
  const { roleIds } = parsed.data;

  // De-duplicate + validate role existence
  const uniqueRoleIds = Array.from(new Set(roleIds));
  let newRoleNames: { id: string; name: string }[] = [];
  if (uniqueRoleIds.length) {
    newRoleNames = await db.role.findMany({
      where: { id: { in: uniqueRoleIds }, deletedAt: null },
      select: { id: true, name: true },
    });
    if (newRoleNames.length !== uniqueRoleIds.length) {
      return badRequest("One or more selected roles are invalid or deleted.");
    }
    // SECURITY: only an MD may grant the MD role. Prevents privilege escalation.
    if (!auth.ctx.isMD && newRoleNames.some((r) => r.name === "md")) {
      return forbidden(
        "Only the Managing Director may assign the Managing Director role.",
      );
    }
  }

  // Capture previous state for audit
  const previous = await db.userRole.findMany({
    where: { userId: id },
    select: { roleId: true, role: { select: { name: true, displayName: true } } },
  });

  // SECURITY: prevent stripping the MD role from the last MD user.
  // If the target currently holds the MD role AND the new set does not
  // include it, ensure at least one other MD remains.
  const hadMD = previous.some((p) => p.role.name === "md");
  const willHaveMD = newRoleNames.some((r) => r.name === "md");
  if (hadMD && !willHaveMD && !auth.ctx.isMD) {
    return forbidden(
      "Only the Managing Director may remove the Managing Director role.",
    );
  }
  if (hadMD && !willHaveMD) {
    const otherMDCount = await db.userRole.count({
      where: {
        role: { name: "md", deletedAt: null },
        user: { deletedAt: null, id: { not: id } },
      },
    });
    if (otherMDCount === 0) {
      return forbidden(
        "Cannot remove the Managing Director role from the last Managing Director account.",
      );
    }
  }

  // Replace within a transaction
  await db.$transaction([
    db.userRole.deleteMany({ where: { userId: id } }),
    ...(uniqueRoleIds.length
      ? [
          db.userRole.createMany({
            data: uniqueRoleIds.map((roleId) => ({
              userId: id,
              roleId,
              assignedById: auth.ctx.userId,
            })),
          }),
        ]
      : []),
  ]);

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "users",
    recordId: id,
    recordType: "User",
    description: `Updated role assignments for ${user.username} (${user.email})`,
    previousValue: previous.map((p) => ({
      id: p.roleId,
      name: p.role.name,
      displayName: p.role.displayName,
    })),
    newValue: uniqueRoleIds,
  });

  return ok({ userId: id, roleIds: uniqueRoleIds });
}
