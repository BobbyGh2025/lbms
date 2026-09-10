// ============================================================================
// LBMS Phase 11 API — Supplier Bill void (ACCRUAL ACCOUNTING)
// ----------------------------------------------------------------------------
// POST /api/payables/bills/[id]/void
//   Transition: posted/partially_paid/paid → voided.
//
//   ACCRUAL ACCOUNTING:
//   If the bill has a journalId (was posted to Finance), reverses the journal
//   via the posting engine's reverseJournal():
//     Dr Accounts Payable (LIB-AP)   — reverses the original Cr — AP goes down
//     Cr Expense                      — reverses the original Dr — expense goes down
//
//   This ensures:
//   - AP is reversed (no longer outstanding)
//   - Expense is reversed (no longer counted)
//   - The original journal is preserved (marked "reversed") — never deleted
//
//   Voiding a bill does NOT void posted payments against it — those must be
//   voided separately (each payment has its own journal to reverse).
//   After void, balanceDue is zeroed (no AP remains).
//
//   Requires `payables:void`. Terminal state.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { isValidBillTransition, recomputeBillBalance } from "@/lib/ap-utils";
import {
  reverseJournal,
  FinanceValidationError,
} from "@/lib/finance/posting-engine";

const VoidSchema = z.object({
  reason: z.string().min(3, "A void reason (min 3 chars) is required."),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("payables", "void");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.supplierBill.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true, billNumber: true, status: true, journalId: true,
      total: true, supplierId: true,
    },
  });
  if (!existing) return notFound("Supplier bill not found.");

  const target = "voided";
  if (existing.status === target) return badRequest("Bill is already voided.");
  if (!isValidBillTransition(existing.status, target)) {
    return badRequest(`Cannot void a ${existing.status} bill.`);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body. A `reason` field is required."); }
  const parsed = VoidSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  const now = new Date();

  try {
    // If the bill was posted (has a journalId), reverse the Expense/AP journal
    let reversalResult: { id: string; reference: string; status: string } | null = null;
    if (existing.journalId) {
      const reversal = await reverseJournal({
        journalId: existing.journalId,
        reason: `Bill ${existing.billNumber} voided: ${d.reason}`,
        createdById: auth.ctx.userId,
      });
      reversalResult = reversal;
    }

    // Update bill status + zero out balance (voided bills have no AP)
    const updated = await db.$transaction(async (tx) => {
      const bal = await recomputeBillBalance(tx, id);
      return tx.supplierBill.update({
        where: { id },
        data: {
          status: target,
          voidedAt: now,
          voidedById: auth.ctx.userId,
          // Voided bills have zero balance due (AP reversed)
          amountPaid: bal?.amountPaid ?? "0",
          balanceDue: "0",
          updatedById: auth.ctx.userId,
        },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "void",
      module: "payables",
      recordId: updated.id,
      recordType: "SupplierBill",
      description: `Voided bill ${updated.billNumber}${reversalResult ? ` — reversed journal ${reversalResult.reference} (Dr LIB-AP / Cr Expense)` : ""}. Reason: ${d.reason}`,
      previousValue: { status: existing.status, journalId: existing.journalId },
      newValue: {
        status: updated.status,
        voidedAt: now,
        reversalJournalId: reversalResult?.id ?? null,
        reversalJournalRef: reversalResult?.reference ?? null,
      },
    });

    return ok({
      bill: updated,
      reversal: reversalResult ? {
        id: reversalResult.id,
        reference: reversalResult.reference,
        status: reversalResult.status,
      } : null,
    });
  } catch (err) {
    if (err instanceof FinanceValidationError) {
      return badRequest(err.message);
    }
    throw err;
  }
}
