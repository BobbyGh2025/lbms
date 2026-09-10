// ============================================================================
// LBMS Phase 10 API — Invoice void
//   POST /api/sales/invoices/[id]/void
//   Transition: any non-terminal → voided. Voiding an invoice does NOT void
//   posted payments against it (those must be voided separately). However,
//   it recomputes the invoice balance so the AR reflects the voided status.
//   Requires `sales:void`. Terminal state.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { isValidInvoiceTransition, INVOICE_TERMINAL, recomputeInvoiceBalance } from "@/lib/sales-utils";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "void");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.invoice.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, invoiceNumber: true, status: true },
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

  const now = new Date();
  const updated = await db.$transaction(async (tx) => {
    const bal = await recomputeInvoiceBalance(tx, id);
    return tx.invoice.update({
      where: { id },
      data: {
        status: target,
        voidedAt: now,
        voidedById: auth.ctx.userId,
        amountPaid: bal?.amountPaid ?? "0",
        balanceDue: bal?.balanceDue ?? "0",
        updatedById: auth.ctx.userId,
      },
    });
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "sales",
    recordId: updated.id,
    recordType: "Invoice",
    description: `Voided invoice ${updated.invoiceNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, voidedAt: now, voidedById: auth.ctx.userId },
  });

  return ok(updated);
}
