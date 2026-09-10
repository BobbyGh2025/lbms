// ============================================================================
// LBMS Phase 11 API — Supplier Payment void (ACCRUAL ACCOUNTING)
// ----------------------------------------------------------------------------
// POST /api/payables/payments/[id]/void
//   Transition: posted → voided.
//
//   ACCRUAL ACCOUNTING:
//   Reverses the payment journal via the posting engine's reverseJournal():
//     Dr FinancialAccount (Cash/Bank)  — reverses the original Cr — cash goes back up
//     Cr Accounts Payable (LIB-AP)    — reverses the original Dr — AP goes back up
//
//   This ensures:
//   - Cash is reversed (no longer counted as paid out)
//   - AP goes back up (the payable is restored)
//   - Expense is NOT affected (it was recognized at bill posting time)
//   - The original journal is preserved (marked "reversed") — never deleted
//
//   Updates payment status + recomputes bill balance (amountPaid decreases,
//   balanceDue increases, status may regress from paid → partially_paid → posted).
//   Requires `payables:void`.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx,
} from "@/lib/api-helpers";
import { recomputeBillBalance } from "@/lib/ap-utils";
import {
  reverseJournal,
  FinanceValidationError,
} from "@/lib/finance/posting-engine";
import { toMoney, ZERO } from "@/lib/finance/money";

const VoidPaymentSchema = z.object({
  reason: z.string().min(3, "A void reason (min 3 chars) is required."),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("payables", "void");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.supplierPayment.findFirst({
    where: { id },
    select: {
      id: true, paymentNumber: true, status: true, journalId: true,
      supplierId: true, supplierBillId: true, amount: true,
    },
  });
  if (!existing) return notFound("Supplier payment not found.");

  if (existing.status === "voided") return badRequest("Payment has already been voided.");
  if (existing.status !== "posted") {
    return badRequest(`Cannot void a ${existing.status} payment. Only posted payments may be voided.`);
  }
  if (!existing.journalId) {
    return badRequest("Payment has no linked journal to reverse (data integrity error).");
  }

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body. A `reason` field is required."); }
  const parsed = VoidPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Capture the bill state BEFORE the void
  let billBefore: { id: string; billNumber: string; status: string } | null = null;
  if (existing.supplierBillId) {
    billBefore = await db.supplierBill.findFirst({
      where: { id: existing.supplierBillId },
      select: { id: true, billNumber: true, status: true },
    });
  }

  try {
    // --- REVERSE THE JOURNAL (Dr Cash / Cr LIB-AP — mirrors the original) ---
    const reversal = await reverseJournal({
      journalId: existing.journalId,
      reason: `Payment ${existing.paymentNumber} voided: ${d.reason}`,
      createdById: auth.ctx.userId,
    });

    // --- UPDATE PAYMENT + RECOMPUTE BILL BALANCE ---
    const result = await db.$transaction(async (tx) => {
      const now = new Date();
      const updatedPayment = await tx.supplierPayment.update({
        where: { id },
        data: {
          status: "voided",
          voidedAt: now,
          voidedById: auth.ctx.userId,
        },
      });

      let updatedBill: Awaited<ReturnType<typeof tx.supplierBill.update>> | null = null;
      if (existing.supplierBillId) {
        const bal = await recomputeBillBalance(tx, existing.supplierBillId);
        if (bal) {
          const balanceMoney = toMoney(bal.balanceDue);
          let newStatus = billBefore?.status ?? "posted";
          // Don't regress to draft/approved/submitted; don't change voided bills
          if (billBefore?.status === "voided") {
            newStatus = "voided";
          } else if (balanceMoney.lte(0)) {
            newStatus = "paid";
          } else if (toMoney(bal.amountPaid).gt(ZERO)) {
            newStatus = "partially_paid";
          } else {
            // No payments remaining — back to posted
            newStatus = "posted";
          }
          updatedBill = await tx.supplierBill.update({
            where: { id: existing.supplierBillId },
            data: {
              amountPaid: bal.amountPaid,
              balanceDue: bal.balanceDue,
              status: newStatus,
              updatedById: auth.ctx.userId,
            },
          });
        }
      }

      return { updatedPayment, updatedBill };
    });

    await auditFromCtx(auth.ctx, {
      action: "void",
      module: "payables",
      recordId: result.updatedPayment.id,
      recordType: "SupplierPayment",
      description: `Voided payment ${result.updatedPayment.paymentNumber} — reversed journal ${reversal.reference} (Dr Cash / Cr LIB-AP). Reason: ${d.reason}`,
      previousValue: { status: existing.status, journalId: existing.journalId },
      newValue: {
        status: result.updatedPayment.status,
        reversalJournalId: reversal.id,
        reversalJournalRef: reversal.reference,
        billStatus: result.updatedBill?.status ?? null,
        billBalanceDue: result.updatedBill?.balanceDue ?? null,
      },
    });

    return ok({
      payment: result.updatedPayment,
      bill: result.updatedBill,
      reversal: {
        id: reversal.id,
        reference: reversal.reference,
        status: reversal.status,
        amount: reversal.amount,
      },
    });
  } catch (err) {
    if (err instanceof FinanceValidationError) {
      return badRequest(err.message);
    }
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A constraint error occurred while voiding. Please retry.");
    }
    throw err;
  }
}
