// ============================================================================
// LBMS Phase 11 API — Supplier Bill cancel
//   POST /api/payables/bills/[id]/cancel
//   Transition: non-posted states (draft, submitted, approved) → voided.
//
//   Cancel is used for bills that have NOT yet been posted to Finance (no
//   journalId, no AP created). For posted bills, use the dedicated VOID
//   endpoint which reverses the journal.
//
//   Optional `reason` field (string). Requires `payables:cancel`.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";

const CancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

// States that may be cancelled (i.e. NOT yet posted to Finance).
const CANCELABLE_STATES = new Set(["draft", "submitted", "approved"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("payables", "cancel");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.supplierBill.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true, billNumber: true, status: true, journalId: true,
      total: true, balanceDue: true,
    },
  });
  if (!existing) return notFound("Supplier bill not found.");

  const target = "voided";
  if (existing.status === target) return badRequest("Bill is already voided.");
  if (!CANCELABLE_STATES.has(existing.status)) {
    return badRequest(
      `Cannot cancel a ${existing.status} bill. Posted bills must be voided (which reverses the journal).`,
    );
  }

  let body: unknown = {};
  try { body = await req.json(); } catch { /* OK — body is optional */ }
  const parsed = CancelSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  const now = new Date();
  const updated = await db.supplierBill.update({
    where: { id },
    data: {
      status: target,
      voidedAt: now,
      voidedById: auth.ctx.userId,
      balanceDue: "0",
      updatedById: auth.ctx.userId,
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "payables",
    recordId: updated.id,
    recordType: "SupplierBill",
    description: `Cancelled bill ${updated.billNumber} from ${existing.status} state${d.reason ? ` — reason: ${d.reason}` : ""}`,
    previousValue: { status: existing.status, balanceDue: existing.balanceDue },
    newValue: {
      status: updated.status,
      voidedAt: now,
      voidedById: auth.ctx.userId,
      reason: d.reason ?? null,
    },
  });

  return ok(updated);
}
