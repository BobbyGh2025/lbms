// ============================================================================
// LBMS Phase 10 API — Customer Payment post (ACCRUAL ACCOUNTING)
// ----------------------------------------------------------------------------
// POST /api/sales/payments/[id]/post
//   Transition: draft → posted.
//
//   ACCRUAL ACCOUNTING (critical fix):
//   Posts a journal via the finance posting engine:
//     Dr FinancialAccount (Cash/Bank)  — cash received
//     Cr Accounts Receivable (AST-AR)  — settles the receivable
//
//   This does NOT credit revenue again (revenue was already recognized at
//   invoice issuance time). This only settles the receivable → cash conversion.
//
//   Stores the returned journalId on the payment for void/reversal.
//   After posting, recomputes the invoice balance + updates invoice
//   amountPaid/balanceDue + auto-advances invoice status.
//   Requires `sales:post`.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx,
} from "@/lib/api-helpers";
import { recomputeInvoiceBalance } from "@/lib/sales-utils";
import {
  postJournal,
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

  let body: unknown = {};
  try { body = await req.json(); } catch { /* OK — body is optional */ }
  const parsed = PostPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }

  // Resolve receiving FinancialAccount (first active asset account)
  const finAcc = await db.financialAccount.findFirst({
    where: { deletedAt: null, status: "active" },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, currency: true },
  });
  if (!finAcc) {
    return badRequest("No active financial account is configured to receive this payment.");
  }

  // Resolve AST-AR ledger account (Accounts Receivable)
  const arLedger = await db.ledgerAccount.findFirst({
    where: { code: "AST-AR", deletedAt: null },
    select: { id: true, code: true, name: true },
  });
  if (!arLedger) {
    return badRequest("Accounts Receivable ledger account (AST-AR) is not configured. Please seed the chart of accounts.");
  }

  // Need the invoice (if linked) for description + balance recompute
  let invoice: { id: string; invoiceNumber: string; status: string; total: any; balanceDue: any } | null = null;
  if (existing.invoiceId) {
    invoice = await db.invoice.findFirst({
      where: { id: existing.invoiceId },
      select: { id: true, invoiceNumber: true, status: true, total: true, balanceDue: true },
    });
    if (!invoice) return badRequest("Linked invoice no longer exists.");
  }

  const amount = toMoney(existing.amount);
  if (amount.lte(0)) return badRequest("Payment amount must be greater than zero.");

  // Overpayment protection: if linked to an invoice, payment cannot exceed balanceDue
  if (invoice) {
    const balance = toMoney(invoice.balanceDue);
    if (amount.gt(balance)) {
      return badRequest(
        `Payment amount (${serializeMoney(amount)}) exceeds invoice balance due (${serializeMoney(balance)}). Overpayment is not permitted.`,
      );
    }
  }

  try {
    // --- POST TO FINANCE: Dr Cash / Cr Accounts Receivable ---
    // This settles the receivable. Revenue was already recognized at invoice
    // issuance time. This posting does NOT create new revenue.
    const journal = await postJournal({
      transactionType: "income", // cash receipt type (reference prefix INC)
      transactionDate: existing.paymentDate,
      description: invoice
        ? `Payment for invoice ${invoice.invoiceNumber} — ${existing.paymentNumber}`
        : `Customer payment ${existing.paymentNumber}`,
      notes: `Settlement of accounts receivable`,
      financialAccountId: finAcc.id,
      customerId: existing.customerId,
      paymentMethod: existing.paymentMethod,
      externalRef: existing.reference ?? existing.paymentNumber,
      createdById: auth.ctx.userId,
      entries: [
        {
          // Debit the FinancialAccount (cash/bank increases)
          financialAccountId: finAcc.id,
          debit: serializeMoney(amount),
          credit: ZERO.toString(),
          description: `Cash received — ${existing.paymentNumber}`,
        },
        {
          // Credit Accounts Receivable (AR decreases — asset decreases with credit)
          ledgerAccountId: arLedger.id,
          debit: ZERO.toString(),
          credit: serializeMoney(amount),
          description: `Accounts Receivable settlement — ${invoice?.invoiceNumber ?? existing.paymentNumber}`,
        },
      ],
    });

    // --- UPDATE PAYMENT RECORD + RECOMPUTE INVOICE BALANCE ---
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

      let updatedInvoice: Awaited<ReturnType<typeof tx.invoice.update>> | null = null;
      if (existing.invoiceId) {
        const bal = await recomputeInvoiceBalance(tx, existing.invoiceId);
        if (bal) {
          const balanceMoney = toMoney(bal.balanceDue);
          let newStatus = invoice!.status;
          // Don't regress to "draft" — if was voided, keep voided
          if (invoice!.status === "voided") {
            newStatus = "voided";
          } else if (balanceMoney.lte(0)) {
            newStatus = "paid";
          } else if (toMoney(bal.amountPaid).gt(ZERO)) {
            newStatus = "partially_paid";
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
      description: `Posted payment ${result.updatedPayment.paymentNumber} (journal ${journal.reference}: Dr Cash / Cr AR)${invoice ? ` against invoice ${invoice.invoiceNumber}` : ""}`,
      previousValue: { status: existing.status, amount: existing.amount },
      newValue: {
        status: result.updatedPayment.status,
        journalId: journal.id,
        journalReference: journal.reference,
        invoiceStatus: result.updatedInvoice?.status ?? null,
        invoiceBalanceDue: result.updatedInvoice?.balanceDue ?? null,
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
