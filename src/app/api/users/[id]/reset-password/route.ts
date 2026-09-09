// ============================================================================
// LBMS Users API — password reset
// ----------------------------------------------------------------------------
// POST /api/users/:id/reset-password   { password }
// ----------------------------------------------------------------------------
// Hashes the new password, updates the user, clears the lockout + failed
// attempt counters, and writes an audit entry. `passwordHash` is never
// returned in any response.
// ============================================================================

import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
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

const ResetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("users", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.user.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, username: true, email: true },
  });
  if (!existing) return notFound("User not found.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }
  const parsed = ResetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return badRequest(first?.message ?? "Invalid request body.", parsed.error.issues);
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  await db.user.update({
    where: { id },
    data: {
      passwordHash,
      // Reset lockout state so the user can immediately sign in with the new
      // password.
      failedLoginAttempts: 0,
      lockedUntil: null,
      mustChangePassword: false,
    },
    select: { id: true },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "users",
    recordId: id,
    recordType: "User",
    description: `Password reset for ${existing.username} (${existing.email})`,
  });

  return ok({ ok: true });
}
