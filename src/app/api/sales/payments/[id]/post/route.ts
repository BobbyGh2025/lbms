// ============================================================================
// LBMS Phase 10 API — Customer Payment post
// ----------------------------------------------------------------------------
// POST /api/sales/payments/[id]/post
//   Transition: draft → posted. Calls postIncome() from the finance posting
//   engine to record the cash receipt (debit FinancialAccount, credit
//   INC-SALES ledger account). Stores the returned journalId on the payment
//   for void/reversal. After posting, recomputes the invoice balance +
//   updates invoice amountPaid/balanceDue + auto-advances invoice status to
//   paid / partially_paid. Requires `sales:post`.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx,
} from "@/lib/api-helpers";
import {
  recomputeInvoiceBalance,
} from "@/lib/sales-utils";
import {
  postIncome,
  FinanceValidationError,
} from "@/lib/finance/posting-engine";
import { toMoney, serializeMoney, ZERO } from "@/lib/finance/money";

const PostPaymentSchema = z.object({
  reason: z.string().optional(),
}).optional();

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "post");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.customerPayment.findFirst({
    where: { id },
    select: {
      id: true, paymentNumber: true, status: true,
      customerId: true, invoiceId: true,
      paymentDate: true, amount: true, paymentMethod: true,
      reference: true, notes: true,
    },
  });
  if (!existing) return notFound("Payment not found.");

  if (existing.status === "posted") return badRequest("Payment has already been posted.");
  if (existing.status !== "draft") {
    return badRequest(`Cannot post a ${existing.status} payment.`);
  }

  // Body is optional (reason for audit only).
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // OK — body is optional.
  }
  const parsed = PostPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }

  // Resolve receiving FinancialAccount (first active asset account, ordered by code).
  const finAcc = await db.financialAccount.findFirst({
    where: { deletedAt: null, status: "active" },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, currency: true },
  });
  if (!finAcc) {
    return badRequest("No active financial account is configured to receive this payment.");
  }

  // Resolve the INC-SALES ledger account.
  const ledger = await db.ledgerAccount.findFirst({
    where: { code: "INC-SALES", deletedAt: null },
    select: { id: true, code: true, name: true },
  });
  if (!ledger) {
    return badRequest("Income category 'INC-SALES' is not configured. Please seed the chart of accounts.");
  }

  // Need the invoice (if linked) for description + balance recompute.
  let invoice: { id: string; invoiceNumber: string; status: string } | null = null;
  if (existing.invoiceId) {
    invoice = await db.invoice.findFirst({
      where: { id: existing.invoiceId },
      select: { id: true, invoiceNumber: true, status: true },
    });
    if (!invoice) return badRequest("Linked invoice no longer exists.");
  }

  const amount = toMoney(existing.amount);
  if (amount.lte(0)) return badRequest("Payment amount must be greater than zero.");

  try {
    // --- POST FINANCE ENTRY (single authoritative path via postIncome) ---
    const journal = await postIncome({
      date: existing.paymentDate,
      amount: serializeMoney(amount),
      financialAccountId: finAcc.id,
      ledgerAccountId: ledger.id,
      description: invoice
        ? `Payment for invoice ${invoice.invoiceNumber}`
        : `Customer payment ${existing.paymentNumber}`,
      customerId: existing.customerId,
      paymentMethod: existing.paymentMethod,
      externalRef: existing.reference ?? existing.paymentNumber,
      createdById: auth.ctx.userId,
    });

    // --- POST PAYMENT RECORD + UPDATE INVOICE BALANCE ---
    const result = await db.$transaction(async (tx) => {
      const now = new Date();
      const updatedPayment = await tx.customerPayment.update({
        where: { id },
        data: {
          status: "posted",
          journalId: journal.id,
          postedAt: now,
        },
      });

      // Recompute invoice balance (if linked) + auto-advance status.
      let updatedInvoice: Awaited<ReturnType<typeof tx.invoice.update>> | null = null;
      if (existing.invoiceId) {
        const bal = await recomputeInvoiceBalance(tx, existing.invoiceId);
        if (bal) {
          const balanceMoney = toMoney(bal.balanceDue);
          let newStatus = invoice!.status;
          if (balanceMoney.lte(0)) newStatus = "paid";
          else if (toMoney(bal.amountPaid).gt(ZERO)) newStatus = "partially_paid";
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
      description: `Posted payment ${result.updatedPayment.paymentNumber} (journal ${journal.reference})${invoice ? ` against invoice ${invoice.invoiceNumber}` : ""}`,
      previousValue: { status: existing.status, amount: existing.amount },
      newValue: {
        status: result.updatedPayment.status,
        journalId: journal.id,
        journalReference: journal.reference,
        invoiceStatus: result.updatedInvoice?.status ?? null,
      },
    });

    return ok({
      payment: result.updatedPayment,
      invoice: result.updatedInvoice,
      journal: {
        id: journal.id,
        reference: journal.reference,
        status: journal.status,
        amount: journal.amount,
        currency: journal.currency,
      },
    });
  } catch (err) {
    if (err instanceof FinanceValidationError) {
      return badRequest(err.message);
    }
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A constraint error occurred while posting. Please retry.");
    }
    throw err;
  }
}
