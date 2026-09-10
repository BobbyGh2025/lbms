// ============================================================================
// LBMS Phase 10 API — Invoice issue
//   POST /api/sales/invoices/[id]/issue
//   Transition: draft → issued. After issue, the invoice is IMMUTABLE (no
//   more PATCH / item edits). Records issuedAt + issuedById. Requires
//   `sales:approve`. Refuses to issue if invoice has no items (zero total).
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { isValidInvoiceTransition, recomputeInvoiceTotals, recomputeInvoiceBalance } from "@/lib/sales-utils";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "issue");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.invoice.findFirst({
    where: { id, ...notDeleted() },
    include: { items: { select: { id: true } } },
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

  const now = new Date();
  const updated = await db.$transaction(async (tx) => {
    // Final totals + balance recomputation before locking the invoice.
    const totals = await recomputeInvoiceTotals(tx, id);
    const bal = await recomputeInvoiceBalance(tx, id);
    return tx.invoice.update({
      where: { id },
      data: {
        status: target,
        issuedAt: now,
        issuedById: auth.ctx.userId,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        amountPaid: bal?.amountPaid ?? "0",
        balanceDue: bal?.balanceDue ?? totals.total,
        updatedById: auth.ctx.userId,
      },
    });
  });

  await auditFromCtx(auth.ctx, {
    action: "approve",
    module: "sales",
    recordId: updated.id,
    recordType: "Invoice",
    description: `Issued invoice ${updated.invoiceNumber}`,
    previousValue: { status: existing.status },
    newValue: { status: updated.status, issuedAt: now, issuedById: auth.ctx.userId, total: updated.total },
  });

  return ok(updated);
}
