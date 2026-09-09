// ============================================================================
// LBMS CRM API — Complete activity
// ----------------------------------------------------------------------------
// POST /api/activities/[id]/complete   mark activity as completed:
//                                       status="completed", completedDate=now.
//                                       Idempotent guard: returns 400 if the
//                                       activity is cancelled (cannot complete
//                                       a cancelled activity). No-op (200) if
//                                       already completed. activities:edit.
//                                       Audit recorded.
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
} from "@/lib/api-helpers";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const CompleteSchema = z.object({
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("activities", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = CompleteSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }

  const existing = await db.activity.findUnique({
    where: { id },
    include: {
      customer: {
        select: { id: true, customerNumber: true, tradingName: true, legalName: true },
      },
      supplier: {
        select: { id: true, supplierNumber: true, tradingName: true, legalName: true },
      },
    },
  });
  if (!existing) return notFound("Activity not found.");

  if (existing.status === "cancelled") {
    return badRequest(
      "Cannot complete an activity that has been cancelled. Reopen or recreate it first.",
    );
  }

  // Idempotent: if already completed, just return the existing record.
  if (existing.status === "completed" && existing.completedDate) {
    return ok(existing);
  }

  // Optionally append the completion notes to the existing description.
  const notesSuffix = parsed.data.notes?.trim()
    ? `\n\n[Completion notes — ${new Date().toISOString().slice(0, 10)}]: ${parsed.data.notes.trim()}`
    : "";

  const updated = await db.activity.update({
    where: { id },
    data: {
      status: "completed",
      completedDate: new Date(),
      ...(notesSuffix
        ? {
            description: existing.description
              ? `${existing.description}${notesSuffix}`
              : notesSuffix.replace(/^\n\n/, ""),
          }
        : {}),
    },
    include: {
      customer: {
        select: { id: true, customerNumber: true, tradingName: true, legalName: true },
      },
      supplier: {
        select: { id: true, supplierNumber: true, tradingName: true, legalName: true },
      },
      assignedTo: {
        select: { id: true, fullName: true, employeeNumber: true },
      },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "activities",
    recordId: updated.id,
    recordType: "Activity",
    description: `Marked activity "${updated.subject}" as completed`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
