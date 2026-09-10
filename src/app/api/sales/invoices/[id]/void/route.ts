// ============================================================================
// LBMS Phase 10 API — Invoice void (ACCRUAL ACCOUNTING)
// ----------------------------------------------------------------------------
// POST /api/sales/invoices/[id]/void
//   Transition: any non-terminal → voided.
//
//   ACCRUAL ACCOUNTING:
//   If the invoice has a journalId (was issued + posted to Finance), reverses
//   the journal via the posting engine's reverseJournal():
//     Dr Sales Revenue (reverses the original Cr)
//     Cr Accounts Receivable (reverses the original Dr)
//
//   This ensures:
//   - Revenue is reversed (no longer counted)
//   - AR is reversed (no longer outstanding)
//   - The original journal is preserved (marked "reversed") — never deleted
//   - Cash is NOT affected (no payment was received against this invoice)
//
//   Voiding an invoice does NOT void posted payments against it — those must
//   be voided separately (each payment has its own journal to reverse).
//
//   Requires `sales:void`. Terminal state.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { isValidInvoiceTransition, INVOICE_TERMINAL, recomputeInvoiceBalance } from "@/lib/sales-utils";
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
  const auth = await authorize("sales", "void");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.invoice.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true, invoiceNumber: true, status: true, journalId: true,
      total: true, customerId: true,
    },
  });
  if (!existing) return notFound("Invoice not found.");

  const target = "voided";
  if (existing.status === target) return badRequest("Invoice is already voided.");
  if (INVOICE_TERMINAL.has(existing.status) && existing.status !== "voided") {
    return badRequest(`Cannot void a ${existing.status} invoice (terminal state).`);
  }
  if (!isValidInvoiceTransition(existing.status, target)) {
    return badRequest(`Cannot void a ${existing.status} invoice.`);
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
    // If the invoice was issued (has a journalId), reverse the AR/Revenue journal
    let reversalResult: { id: string; reference: string; status: string } | null = null;
    if (existing.journalId) {
      const reversal = await reverseJournal({
        journalId: existing.journalId,
        reason: `Invoice ${existing.invoiceNumber} voided: ${d.reason}`,
        createdById: auth.ctx.userId,
      });
      reversalResult = reversal;
    }

    // Update invoice status + zero out balance (voided invoices have no AR)
    const updated = await db.$transaction(async (tx) => {
      const bal = await recomputeInvoiceBalance(tx, id);
      return tx.invoice.update({
        where: { id },
        data: {
          status: target,
          voidedAt: now,
          voidedById: auth.ctx.userId,
          // Voided invoices have zero balance due (AR reversed)
          amountPaid: bal?.amountPaid ?? "0",
          balanceDue: "0",
          updatedById: auth.ctx.userId,
        },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "update",
      module: "sales",
      recordId: updated.id,
      recordType: "Invoice",
      description: `Voided invoice ${updated.invoiceNumber}${reversalResult ? ` — reversed journal ${reversalResult.reference} (reverses Dr AR / Cr Revenue)` : ""}. Reason: ${d.reason}`,
      previousValue: { status: existing.status, journalId: existing.journalId },
      newValue: {
        status: updated.status,
        voidedAt: now,
        reversalJournalId: reversalResult?.id ?? null,
        reversalJournalRef: reversalResult?.reference ?? null,
      },
    });

    return ok({
      invoice: updated,
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
