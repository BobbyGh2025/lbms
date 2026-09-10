// ============================================================================
// LBMS Phase 10 API — Invoice issue (ACCRUAL ACCOUNTING)
// ----------------------------------------------------------------------------
// POST /api/sales/invoices/[id]/issue
//   Transition: draft → issued. After issue, the invoice is IMMUTABLE.
//
//   ACCRUAL ACCOUNTING (critical fix):
//   On issue, posts a journal via the finance posting engine:
//     Dr Accounts Receivable (AST-AR)   — creates AR in the ledger
//     Cr Sales Revenue (INC-SALES)      — recognizes revenue at invoice time
//
//   This ensures:
//   - Revenue is recognized when invoiced (accrual basis)
//   - AR balance appears in the Finance ledger (reconciles with operational AR)
//   - Cash is NOT affected at invoice time (only at payment time)
//
//   Stores the journalId on the invoice for void/reversal.
//   Double-posting prevention: journalId is set atomically; a second issue
//   attempt returns 400 (already issued).
//
//   Requires `sales:issue`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import {
  isValidInvoiceTransition, recomputeInvoiceTotals, recomputeInvoiceBalance,
} from "@/lib/sales-utils";
import { postJournal, FinanceValidationError } from "@/lib/finance/posting-engine";
import { toMoney, serializeMoney, ZERO } from "@/lib/finance/money";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "issue");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.invoice.findFirst({
    where: { id, ...notDeleted() },
    include: {
      items: { select: { id: true } },
      customer: { select: { id: true, tradingName: true, legalName: true } },
    },
  });
  if (!existing) return notFound("Invoice not found.");

  const target = "issued";
  if (existing.status === target) return badRequest("Invoice has already been issued.");
  if (!isValidInvoiceTransition(existing.status, target)) {
    return badRequest(
      `Cannot issue a ${existing.status} invoice. Only draft invoices may be issued.`,
    );
  }

  if (existing.items.length === 0) {
    return badRequest("Cannot issue an invoice with no line items.");
  }

  // Resolve AST-AR ledger account (Accounts Receivable — asset class)
  const arLedger = await db.ledgerAccount.findFirst({
    where: { code: "AST-AR", deletedAt: null },
    select: { id: true, code: true, name: true },
  });
  if (!arLedger) {
    return badRequest("Accounts Receivable ledger account (AST-AR) is not configured. Please seed the chart of accounts.");
  }

  // Resolve INC-SALES ledger account (Sales Revenue — income class)
  const revLedger = await db.ledgerAccount.findFirst({
    where: { code: "INC-SALES", deletedAt: null },
    select: { id: true, code: true, name: true },
  });
  if (!revLedger) {
    return badRequest("Sales Revenue ledger account (INC-SALES) is not configured. Please seed the chart of accounts.");
  }

  const now = new Date();

  // Step 1: Finalize totals BEFORE posting to Finance (so the journal amount is correct)
  const totals = await db.$transaction(async (tx) => {
    const t = await recomputeInvoiceTotals(tx, id);
    const bal = await recomputeInvoiceBalance(tx, id);
    await tx.invoice.update({
      where: { id },
      data: {
        subtotal: t.subtotal,
        tax: t.tax,
        total: t.total,
        amountPaid: bal?.amountPaid ?? "0",
        balanceDue: bal?.balanceDue ?? t.total,
      },
    });
    return t;
  });

  const invoiceTotal = toMoney(totals.total);
  if (invoiceTotal.lte(0)) {
    return badRequest("Cannot issue an invoice with zero total.");
  }

  try {
    // Step 2: POST TO FINANCE — Dr AR / Cr Revenue (accrual basis)
    // This recognizes revenue at invoice time and creates an AR balance in the ledger.
    // Uses the generic postJournal (not postIncome) because we need Dr ledger / Cr ledger,
    // not Dr financialAccount / Cr ledger.
    const journal = await postJournal({
      transactionType: "income", // revenue recognition
      transactionDate: now,
      description: `Invoice ${existing.invoiceNumber} — ${existing.customer?.tradingName || existing.customer?.legalName || "Customer"}`,
      notes: `Revenue recognition for invoice ${existing.invoiceNumber}`,
      customerId: existing.customerId,
      projectId: existing.projectId ?? undefined,
      externalRef: existing.invoiceNumber,
      createdById: auth.ctx.userId,
      entries: [
        {
          // Debit Accounts Receivable (asset increases with debit)
          ledgerAccountId: arLedger.id,
          debit: serializeMoney(invoiceTotal),
          credit: ZERO.toString(),
          description: `Accounts Receivable — Invoice ${existing.invoiceNumber}`,
        },
        {
          // Credit Sales Revenue (income increases with credit)
          ledgerAccountId: revLedger.id,
          debit: ZERO.toString(),
          credit: serializeMoney(invoiceTotal),
          description: `Sales Revenue — Invoice ${existing.invoiceNumber}`,
        },
      ],
    });

    // Step 3: Update invoice status + store journalId (atomic, prevents double-posting)
    const updated = await db.invoice.update({
      where: { id },
      data: {
        status: target,
        issuedAt: now,
        issuedById: auth.ctx.userId,
        journalId: journal.id,
      },
    });

    await auditFromCtx(auth.ctx, {
      action: "approve",
      module: "sales",
      recordId: updated.id,
      recordType: "Invoice",
      description: `Issued invoice ${updated.invoiceNumber} (total ${serializeMoney(invoiceTotal)}) — posted journal ${journal.reference} (Dr AR / Cr Revenue)`,
      previousValue: { status: existing.status },
      newValue: {
        status: updated.status,
        issuedAt: now,
        journalId: journal.id,
        journalReference: journal.reference,
        total: totals.total,
      },
    });

    return ok({
      invoice: updated,
      journal: {
        id: journal.id,
        reference: journal.reference,
        status: journal.status,
        amount: journal.amount,
      },
    });
  } catch (err) {
    if (err instanceof FinanceValidationError) {
      return badRequest(err.message);
    }
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("Invoice may have already been posted. Please verify the invoice status.");
    }
    throw err;
  }
}
