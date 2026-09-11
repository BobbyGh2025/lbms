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
import { Prisma } from "@prisma/client";
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

  // Need the invoice (if linked) for description + overpayment guard.
  // NOTE: the authoritative concurrency-safe balance check is performed INSIDE
  // the transaction below (atomic conditional reservation on the invoice row).
  // The pre-transaction read here is only for an early-reject fast path and for
  // building the journal description.
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

  // Pre-transaction fast-path overpayment rejection (non-authoritative; the
  // authoritative check is the atomic conditional reservation below). This
  // avoids spinning up a transaction + posting for clearly-invalid requests
  // (e.g. GHS 11,000 against a GHS 10,000 invoice).
  if (invoice) {
    const balance = toMoney(invoice.balanceDue);
    if (amount.gt(balance)) {
      return badRequest(
        `Payment amount (${serializeMoney(amount)}) exceeds invoice balance due (${serializeMoney(balance)}). Overpayment is not permitted.`,
      );
    }
  }

  try {
    // ATOMIC CLAIM #1 — only one request can transition THIS payment draft→posted.
    const claim = await db.customerPayment.updateMany({
      where: { id, status: "draft" },
      data: { status: "posting" },
    });
    if (claim.count === 0) {
      return badRequest("Payment has already been posted or is not in draft state.");
    }

    // ATOMIC CLAIM #2 — reserve the outstanding balance against the INVOICE row.
    // This is the concurrency-safe overpayment guard. The UPDATE acquires a
    // row-level lock on the invoice (PostgreSQL) / serializes on the write
    // (SQLite) so two concurrent payments against the same invoice cannot both
    // pass the `balanceDue >= amount` predicate. If claim2.count === 0, another
    // concurrent payment has already reserved the balance → reject this one.
    //
    // We DECIMAL-reserve by atomically decrementing balanceDue and incrementing
    // amountPaid. If postJournal() subsequently fails, the recovery block below
    // REVERSES this reservation (adds amount back to balanceDue).
    let invoiceReserved: { balanceDue: Prisma.Decimal; amountPaid: Prisma.Decimal } | null = null;
    if (existing.invoiceId) {
      const reservation = await db.invoice.updateMany({
        where: {
          id: existing.invoiceId,
          balanceDue: { gte: amount },
        },
        data: {
          balanceDue: { decrement: amount },
          amountPaid: { increment: amount },
        },
      });
      if (reservation.count === 0) {
        // Another concurrent payment reserved the balance first — revert the
        // per-payment claim and reject.
        await db.customerPayment.updateMany({
          where: { id, status: "posting" },
          data: { status: "draft" },
        }).catch(() => {});
        const inv = await db.invoice.findUnique({
          where: { id: existing.invoiceId },
          select: { balanceDue: true },
        });
        return badRequest(
          `Payment amount (${serializeMoney(amount)}) exceeds the current invoice balance due (${serializeMoney(inv?.balanceDue ?? 0)}). Overpayment is not permitted.`,
        );
      }
      invoiceReserved = await db.invoice.findUnique({
        where: { id: existing.invoiceId },
        select: { balanceDue: true, amountPaid: true },
      });
    }

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

    // --- FINALIZE PAYMENT RECORD + INVOICE STATUS ---
    // The balanceDue/amountPaid were already atomically reserved above (atomic
    // increment/decrement on the invoice row). We must NOT recompute + overwrite
    // them here — doing so would reintroduce a lost-update race under
    // concurrency (two txns each recompute a stale sum and overwrite each other).
    // We only advance the invoice STATUS based on the already-reserved balance.
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
        // Read the CURRENT (already-reserved) balanceDue — do not recompute/overwrite.
        const current = await tx.invoice.findUnique({
          where: { id: existing.invoiceId },
          select: { balanceDue: true, amountPaid: true, status: true },
        });
        if (current) {
          const balanceMoney = toMoney(current.balanceDue);
          let newStatus = invoice!.status;
          // Don't regress to "draft" — if was voided, keep voided
          if (invoice!.status === "voided") {
            newStatus = "voided";
          } else if (balanceMoney.lte(0)) {
            newStatus = "paid";
          } else if (toMoney(current.amountPaid).gt(ZERO)) {
            newStatus = "partially_paid";
          }
          // Only persist the status — amountPaid/balanceDue are authoritative
          // from the atomic reservation and must not be overwritten by a
          // recompute (which would race under concurrency).
          updatedInvoice = await tx.invoice.update({
            where: { id: existing.invoiceId },
            data: {
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
        invoiceReservedBalanceDue: invoiceReserved?.balanceDue?.toString() ?? null,
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
    // Recovery: if postJournal failed, revert BOTH the per-payment claim AND
    // the invoice balance reservation (add the amount back to balanceDue).
    await db.customerPayment.updateMany({
      where: { id, status: "posting" },
      data: { status: "draft" },
    }).catch(() => {});
    if (existing.invoiceId) {
      await db.invoice.update({
        where: { id: existing.invoiceId },
        data: {
          balanceDue: { increment: amount },
          amountPaid: { decrement: amount },
        },
      }).catch(() => {});
    }

    if (err instanceof FinanceValidationError) {
      return badRequest(err.message);
    }
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A constraint error occurred while posting. Please retry.");
    }
    throw err;
  }
}
