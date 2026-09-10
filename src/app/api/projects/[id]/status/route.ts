// ============================================================================
// LBMS Phase 5 API — Project lifecycle status transition
// ----------------------------------------------------------------------------
// POST /api/projects/[id]/status   transition a project between lifecycle
//                                   states. Body: { status }.
//                                   Valid transitions enforced server-side
//                                   via PROJECT_TRANSITIONS map:
//                                     planning → active | cancelled
//                                     active   → on_hold | completed | cancelled
//                                     on_hold  → active
//                                     completed / cancelled are terminal
//                                   (no outbound edges).
//                                   When transitioning to "completed",
//                                   actualEndDate is stamped = now.
//                                   Requires `projects:edit`. Audit recorded
//                                   with previousValue + newValue.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
  badRequest,
  notFound,
  auditFromCtx,
  notDeleted,
} from "@/lib/api-helpers";
import {
  PROJECT_STATUSES,
  isValidTransition,
} from "@/lib/project-utils";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const TransitionSchema = z.object({
  status: z.enum(PROJECT_STATUSES),
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("projects", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = TransitionSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  const existing = await db.project.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Project not found.");

  const from = existing.status;
  const to = d.status;

  // No-op: same status
  if (from === to) {
    return badRequest(`Project is already in status "${to}".`);
  }

  // Enforce the transition graph
  if (!isValidTransition(from, to)) {
    return badRequest(
      `Invalid lifecycle transition: ${from} → ${to}. Allowed transitions from "${from}": ${
        (PROJECT_TRANSITIONS_LIST[from] ?? []).join(", ") || "(none — terminal state)"
      }`,
    );
  }

  const data: Record<string, unknown> = {
    status: to,
    updatedById: auth.ctx.userId,
    updatedAt: new Date(),
  };

  // Stamp actualEndDate when transitioning to "completed".
  if (to === "completed") {
    data.actualEndDate = new Date();
  }

  // Clear actualEndDate if reopening out of completed (only edge back is
  // on_hold → active — completed has no outbound edges so this is defensive
  // only; left here for future-proofing if transitions expand).
  if (from === "completed" && to !== "completed") {
    data.actualEndDate = null;
  }

  const updated = await db.project.update({
    where: { id },
    data,
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "projects",
    recordId: updated.id,
    recordType: "Project",
    description: `Transitioned project ${updated.projectNumber} (${updated.name}) status: ${from} → ${to}${
      d.reason ? ` — reason: ${d.reason}` : ""
    }`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}

// Local copy of the transition map for error-message rendering (avoids
// leaking the readonly tuple typing of PROJECT_TRANSITIONS into the response).
const PROJECT_TRANSITIONS_LIST: Record<string, string[]> = {
  planning: ["active", "cancelled"],
  active: ["on_hold", "completed", "cancelled"],
  on_hold: ["active"],
  completed: [],
  cancelled: [],
};
