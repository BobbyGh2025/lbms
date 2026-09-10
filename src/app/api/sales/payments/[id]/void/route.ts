// ============================================================================
// LBMS Phase 10 API — Customer Payment void (ACCRUAL ACCOUNTING)
// ----------------------------------------------------------------------------
// POST /api/sales/payments/[id]/void
//   Transition: posted → voided.
//
//   ACCRUAL ACCOUNTING:
//   Reverses the payment journal via the posting engine's reverseJournal():
//     Dr Accounts Receivable (reverses the original Cr — AR goes back up)
//     Cr Cash/Bank (reverses the original Dr — cash goes back down)
//
//   This ensures:
//   - Cash is reversed (no longer counted as collected)
//   - AR goes back up (the receivable is restored)
//   - Revenue is NOT affected (it was recognized at invoice time, not at payment)
//   - The original journal is preserved (marked "reversed") — never deleted
//
//   Updates payment status + recomputes invoice balance (amountPaid decreases,
//   balanceDue increases, status may regress from paid → partially_paid → issued).
//   Requires `sales:void`.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx,
} from "@/lib/api-helpers";
import { recomputeInvoiceBalance } from "@/lib/sales-utils";
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
  const auth = await authorize("sales", "void");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.customerPayment.findFirst({
    where: { id },
    select: {
      id: true, paymentNumber: true, status: true, journalId: true,
      customerId: true, invoiceId: true, amount: true,
    },
  });
  if (!existing) return notFound("Payment not found.");

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

  // Capture the invoice state BEFORE the void
  let invoiceBefore: { id: string; invoiceNumber: string; status: string } | null = null;
  if (existing.invoiceId) {
    invoiceBefore = await db.invoice.findFirst({
      where: { id: existing.invoiceId },
      select: { id: true, invoiceNumber: true, status: true },
    });
  }

  try {
    // --- REVERSE THE JOURNAL (Dr AR / Cr Cash — mirrors the original) ---
    const reversal = await reverseJournal({
      journalId: existing.journalId,
      reason: `Payment ${existing.paymentNumber} voided: ${d.reason}`,
      createdById: auth.ctx.userId,
    });

    // --- UPDATE PAYMENT + RECOMPUTE INVOICE BALANCE ---
    const result = await db.$transaction(async (tx) => {
      const now = new Date();
      const updatedPayment = await tx.customerPayment.update({
        where: { id },
        data: {
          status: "voided",
          voidedAt: now,
          voidedById: auth.ctx.userId,
        },
      });

      let updatedInvoice: Awaited<ReturnType<typeof tx.invoice.update>> | null = null;
      if (existing.invoiceId) {
        const bal = await recomputeInvoiceBalance(tx, existing.invoiceId);
        if (bal) {
          const balanceMoney = toMoney(bal.balanceDue);
          let newStatus = invoiceBefore?.status ?? "issued";
          // Don't regress to draft; don't change voided invoices
          if (invoiceBefore?.status === "voided") {
            newStatus = "voided";
          } else if (balanceMoney.lte(0)) {
            newStatus = "paid";
          } else if (toMoney(bal.amountPaid).gt(ZERO)) {
            newStatus = "partially_paid";
          } else {
            // No payments remaining — back to issued
            newStatus = "issued";
          }
          updatedInvoice = await tx.invoice.update({
            where: { id: existing.invoiceId },
            data: {
              amountPaid: bal.amountPaid,
              balanceDue: bal.balanceDue,
              status: newStatus,
              updatedById: auth.ctx.userId,
            },
          });
        }
      }

      return { updatedPayment, updatedInvoice };
    });

    await auditFromCtx(auth.ctx, {
      action: "update",
      module: "sales",
      recordId: result.updatedPayment.id,
      recordType: "CustomerPayment",
      description: `Voided payment ${result.updatedPayment.paymentNumber} — reversed journal ${reversal.reference} (Dr AR / Cr Cash). Reason: ${d.reason}`,
      previousValue: { status: existing.status, journalId: existing.journalId },
      newValue: {
        status: result.updatedPayment.status,
        reversalJournalId: reversal.id,
        reversalJournalRef: reversal.reference,
        invoiceStatus: result.updatedInvoice?.status ?? null,
        invoiceBalanceDue: result.updatedInvoice?.balanceDue ?? null,
      },
    });

    return ok({
      payment: result.updatedPayment,
      invoice: result.updatedInvoice,
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
