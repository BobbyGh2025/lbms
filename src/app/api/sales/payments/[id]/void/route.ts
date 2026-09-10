// ============================================================================
// LBMS Phase 10 API — Customer Payment void
// ----------------------------------------------------------------------------
// POST /api/sales/payments/[id]/void
//   Transition: posted → voided. Reverses the journal via voidJournal() from
//   the finance posting engine. Updates payment status + invoice amountPaid/
//   balanceDue + auto-advances invoice status (paid→partially_paid or issued).
//   Requires a `reason` field in the body (min 3 chars, enforced by the
//   posting engine). Requires `sales:void`.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx,
} from "@/lib/api-helpers";
import { recomputeInvoiceBalance } from "@/lib/sales-utils";
import {
  voidJournal,
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
    return badRequest(
      "Payment has no linked journal to void (data integrity error). Re-post the payment or contact support.",
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body. A `reason` field is required.");
  }

  const parsed = VoidPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Capture the invoice state BEFORE the void (so we can detect paid→partially_paid).
  let invoiceBefore: { id: string; invoiceNumber: string; status: string } | null = null;
  if (existing.invoiceId) {
    invoiceBefore = await db.invoice.findFirst({
      where: { id: existing.invoiceId },
      select: { id: true, invoiceNumber: true, status: true },
    });
  }

  try {
    // --- VOID THE JOURNAL (authoritative path via posting engine) ---
    const voidedJournal = await voidJournal({
      journalId: existing.journalId,
      reason: d.reason,
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
          // Determine new invoice status:
          //  - If balance is back to full → issued (or back to partially_paid if other payments remain)
          //  - If balance is partial → partially_paid
          //  - If still zero (rare: other payments covered) → paid
          let newStatus = invoiceBefore?.status ?? "issued";
          if (balanceMoney.lte(0)) {
            newStatus = "paid";
          } else if (toMoney(bal.amountPaid).gt(ZERO)) {
            newStatus = "partially_paid";
          } else {
            // No payments remaining — back to issued (unless original was draft, which shouldn't be).
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
      description: `Voided payment ${result.updatedPayment.paymentNumber} (journal ${voidedJournal.reference} voided). Reason: ${d.reason}`,
      previousValue: { status: existing.status, journalId: existing.journalId },
      newValue: {
        status: result.updatedPayment.status,
        voidedJournalRef: voidedJournal.reference,
        invoiceStatus: result.updatedInvoice?.status ?? null,
      },
    });

    return ok({
      payment: result.updatedPayment,
      invoice: result.updatedInvoice,
      journal: {
        id: voidedJournal.id,
        reference: voidedJournal.reference,
        status: voidedJournal.status,
        voidedAt: voidedJournal.voidedAt,
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
