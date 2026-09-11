// ============================================================================
// LBMS Phase 11 API — Supplier Payment post (ACCRUAL ACCOUNTING)
// ----------------------------------------------------------------------------
// POST /api/payables/payments/[id]/post
//   Transition: draft → posted.
//
//   ACCRUAL ACCOUNTING:
//   Posts a journal via the finance posting engine:
//     Dr Accounts Payable (LIB-AP)     — settles the payable (AP goes down)
//     Cr FinancialAccount (Cash/Bank)  — cash goes out
//
//   This does NOT debit expense again (expense was recognized at bill posting
//   time). This only settles the payable → cash conversion.
//
//   Stores the returned journalId on the payment for void/reversal.
//   After posting, recomputes the bill balance + auto-advances bill status
//   (paid / partially_paid).
//   Requires `payables:post`.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx,
} from "@/lib/api-helpers";
import { recomputeBillBalance } from "@/lib/ap-utils";
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
  const auth = await authorize("payables", "post");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.supplierPayment.findFirst({
    where: { id },
    select: {
      id: true, paymentNumber: true, status: true,
      supplierId: true, supplierBillId: true,
      financialAccountId: true,
      paymentDate: true, amount: true, paymentMethod: true,
      reference: true, notes: true,
    },
  });
  if (!existing) return notFound("Supplier payment not found.");

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

  // Resolve paying FinancialAccount (must be active)
  const finAcc = await db.financialAccount.findFirst({
    where: { id: existing.financialAccountId, deletedAt: null, status: "active" },
    select: { id: true, code: true, name: true, currency: true },
  });
  if (!finAcc) {
    return badRequest("Paying financial account no longer exists or is inactive.");
  }

  // Resolve LIB-AP ledger account (Accounts Payable — liability class)
  const apLedger = await db.ledgerAccount.findFirst({
    where: { code: "LIB-AP", deletedAt: null },
    select: { id: true, code: true, name: true },
  });
  if (!apLedger) {
    return badRequest("Accounts Payable ledger account (LIB-AP) is not configured. Please seed the chart of accounts.");
  }

  // Need the bill (if linked) for description + overpayment guard.
  // NOTE: the authoritative concurrency-safe balance check is performed INSIDE
  // the transaction below (atomic conditional reservation on the bill row).
  // The pre-transaction read here is only for an early-reject fast path and for
  // building the journal description.
  let bill: { id: string; billNumber: string; status: string; total: any; balanceDue: any } | null = null;
  if (existing.supplierBillId) {
    bill = await db.supplierBill.findFirst({
      where: { id: existing.supplierBillId },
      select: { id: true, billNumber: true, status: true, total: true, balanceDue: true },
    });
    if (!bill) return badRequest("Linked bill no longer exists.");
  }

  const amount = toMoney(existing.amount);
  if (amount.lte(0)) return badRequest("Payment amount must be greater than zero.");

  // Pre-transaction fast-path overpayment rejection (non-authoritative; the
  // authoritative check is the atomic conditional reservation below).
  if (bill) {
    const balance = toMoney(bill.balanceDue);
    if (amount.gt(balance)) {
      return badRequest(
        `Payment amount (${serializeMoney(amount)}) exceeds bill balance due (${serializeMoney(balance)}). Overpayment is not permitted.`,
      );
    }
  }

  try {
    // ATOMIC CLAIM #1 — only one request can transition THIS payment draft→posted.
    const claim = await db.supplierPayment.updateMany({
      where: { id, status: "draft" },
      data: { status: "posting" },
    });
    if (claim.count === 0) {
      return badRequest("Payment has already been posted or is not in draft state.");
    }

    // ATOMIC CLAIM #2 — reserve the outstanding balance against the BILL row.
    // This is the concurrency-safe overpayment guard. The UPDATE acquires a
    // row-level lock on the bill (PostgreSQL) / serializes on the write
    // (SQLite) so two concurrent payments against the same bill cannot both
    // pass the `balanceDue >= amount` predicate. If claim2.count === 0, another
    // concurrent payment has already reserved the balance → reject this one.
    //
    // If postJournal() subsequently fails, the recovery block below REVERSES
    // this reservation (adds amount back to balanceDue).
    let billReserved: { balanceDue: Prisma.Decimal; amountPaid: Prisma.Decimal } | null = null;
    if (existing.supplierBillId) {
      const reservation = await db.supplierBill.updateMany({
        where: {
          id: existing.supplierBillId,
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
        await db.supplierPayment.updateMany({
          where: { id, status: "posting" },
          data: { status: "draft" },
        }).catch(() => {});
        const bl = await db.supplierBill.findUnique({
          where: { id: existing.supplierBillId },
          select: { balanceDue: true },
        });
        return badRequest(
          `Payment amount (${serializeMoney(amount)}) exceeds the current bill balance due (${serializeMoney(bl?.balanceDue ?? 0)}). Overpayment is not permitted.`,
        );
      }
      billReserved = await db.supplierBill.findUnique({
        where: { id: existing.supplierBillId },
        select: { balanceDue: true, amountPaid: true },
      });
    }

    // --- POST TO FINANCE: Dr LIB-AP / Cr Cash ---
    // This settles the payable. Expense was already recognized at bill posting
    // time. This posting does NOT create new expense.
    const journal = await postJournal({
      transactionType: "expense",
      transactionDate: existing.paymentDate,
      description: bill
        ? `Payment for bill ${bill.billNumber} — ${existing.paymentNumber}`
        : `Supplier payment ${existing.paymentNumber}`,
      notes: `Settlement of accounts payable`,
      financialAccountId: finAcc.id,
      partyType: "supplier",
      supplierId: existing.supplierId,
      paymentMethod: existing.paymentMethod,
      externalRef: existing.reference ?? existing.paymentNumber,
      createdById: auth.ctx.userId,
      entries: [
        {
          // Debit Accounts Payable (liability decreases with debit)
          ledgerAccountId: apLedger.id,
          debit: serializeMoney(amount),
          credit: ZERO.toString(),
          description: `Accounts Payable settlement — ${bill?.billNumber ?? existing.paymentNumber}`,
        },
        {
          // Credit the FinancialAccount (cash/bank decreases — asset decreases with credit)
          financialAccountId: finAcc.id,
          debit: ZERO.toString(),
          credit: serializeMoney(amount),
          description: `Cash paid out — ${existing.paymentNumber}`,
        },
      ],
    });

    // --- UPDATE PAYMENT RECORD + BILL STATUS ---
    // The balanceDue/amountPaid were already atomically reserved above (atomic
    // increment/decrement on the bill row). We must NOT recompute + overwrite
    // them here — doing so would reintroduce a lost-update race under
    // concurrency (two txns each recompute a stale sum and overwrite each other).
    // We only advance the bill STATUS based on the already-reserved balance.
    const result = await db.$transaction(async (tx) => {
      const now = new Date();
      const updatedPayment = await tx.supplierPayment.update({
        where: { id },
        data: {
          status: "posted",
          journalId: journal.id,
          postedAt: now,
        },
      });

      let updatedBill: Awaited<ReturnType<typeof tx.supplierBill.update>> | null = null;
      if (existing.supplierBillId) {
        // Read the CURRENT (already-reserved) balanceDue — do not recompute/overwrite.
        const current = await tx.supplierBill.findUnique({
          where: { id: existing.supplierBillId },
          select: { balanceDue: true, amountPaid: true, status: true },
        });
        if (current) {
          const balanceMoney = toMoney(current.balanceDue);
          let newStatus = bill!.status;
          // Don't regress to non-paid states; if was voided, keep voided
          if (bill!.status === "voided") {
            newStatus = "voided";
          } else if (balanceMoney.lte(0)) {
            newStatus = "paid";
          } else if (toMoney(current.amountPaid).gt(ZERO)) {
            newStatus = "partially_paid";
          }
          // Only persist the status — amountPaid/balanceDue are authoritative
          // from the atomic reservation and must not be overwritten by a
          // recompute (which would race under concurrency).
          updatedBill = await tx.supplierBill.update({
            where: { id: existing.supplierBillId },
            data: {
              status: newStatus,
              updatedById: auth.ctx.userId,
            },
          });
        }
      }

      return { updatedPayment, updatedBill };
    });

    await auditFromCtx(auth.ctx, {
      action: "update",
      module: "payables",
      recordId: result.updatedPayment.id,
      recordType: "SupplierPayment",
      description: `Posted payment ${result.updatedPayment.paymentNumber} (journal ${journal.reference}: Dr LIB-AP / Cr Cash)${bill ? ` against bill ${bill.billNumber}` : ""}`,
      previousValue: { status: existing.status, amount: existing.amount },
      newValue: {
        status: result.updatedPayment.status,
        journalId: journal.id,
        journalReference: journal.reference,
        billStatus: result.updatedBill?.status ?? null,
        billBalanceDue: result.updatedBill?.balanceDue ?? null,
        billReservedBalanceDue: billReserved?.balanceDue?.toString() ?? null,
      },
    });

    return ok({
      payment: result.updatedPayment,
      bill: result.updatedBill,
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
    // the bill balance reservation (add the amount back to balanceDue).
    await db.supplierPayment.updateMany({
      where: { id, status: "posting" },
      data: { status: "draft" },
    }).catch(() => {});
    if (existing.supplierBillId) {
      await db.supplierBill.update({
        where: { id: existing.supplierBillId },
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
