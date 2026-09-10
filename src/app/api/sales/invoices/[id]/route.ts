// ============================================================================
// LBMS Phase 10 API — Invoice single-record
// ----------------------------------------------------------------------------
// GET   /api/sales/invoices/[id]   fetch one invoice with items + payments +
//   customer + salesOrder. Derives `overdue` flag.
// PATCH /api/sales/invoices/[id]   edit a DRAFT invoice only. invoiceNumber +
//   customerId immutable. Recomputes totals. Requires `sales:edit`.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
  badRequest,
  notFound,
  auditFromCtx,
  notDeleted,
} from "@/lib/api-helpers";
import {
  INVOICE_TERMINAL,
  recomputeInvoiceTotals,
  recomputeInvoiceBalance,
  isInvoiceOverdue,
} from "@/lib/sales-utils";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const PatchInvoiceSchema = z.object({
  projectId: z.string().nullable().optional(),
  salesOrderId: z.string().nullable().optional(),
  issueDate: dateString.optional(),
  dueDate: dateString.optional(),
  notes: z.string().max(5000).optional(),
  terms: z.string().max(5000).optional(),
});

const PROJECT_TERMINAL = new Set(["completed", "cancelled"]);

// ---------------------------------------------------------------------------
// GET /api/sales/invoices/[id]
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const invoice = await db.invoice.findFirst({
    where: { id, ...notDeleted() },
    include: {
      customer: {
        select: {
          id: true, customerNumber: true, tradingName: true, legalName: true,
          firstName: true, lastName: true, email: true, phone: true, status: true,
          country: true, city: true,
        },
      },
      project: { select: { id: true, projectNumber: true, name: true, status: true } },
      salesOrder: { select: { id: true, orderNumber: true, status: true } },
      createdBy: { select: { id: true, username: true } },
      updatedBy: { select: { id: true, username: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          inventoryItem: {
            select: { id: true, itemCode: true, name: true, unitOfMeasure: true },
          },
        },
      },
      payments: {
        orderBy: { paymentDate: "desc" },
        include: {
          createdBy: { select: { id: true, username: true } },
        },
      },
    },
  });
  if (!invoice) return notFound("Invoice not found.");

  // Recompute balance defensively (in case stale) — but don't persist on read.
  return ok({
    ...invoice,
    overdue: isInvoiceOverdue({
      dueDate: invoice.dueDate,
      balanceDue: invoice.balanceDue,
      status: invoice.status,
    }),
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/sales/invoices/[id]
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.invoice.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Invoice not found.");

  if (existing.status !== "draft") {
    if (INVOICE_TERMINAL.has(existing.status)) {
      return badRequest(`Cannot edit a ${existing.status} invoice.`);
    }
    return badRequest(
      `Cannot edit a ${existing.status} invoice. Only draft invoices may be edited.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = PatchInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // --- Validate projectId ---
  if (d.projectId !== undefined && d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true, status: true },
    });
    if (!project) return badRequest("Selected project does not exist or is archived.");
    if (PROJECT_TERMINAL.has(project.status)) {
      return badRequest(`Cannot link an invoice against a ${project.status} project.`);
    }
  }

  // --- Validate salesOrderId (must match customer if provided) ---
  if (d.salesOrderId) {
    const order = await db.salesOrder.findFirst({
      where: { id: d.salesOrderId, ...notDeleted() },
      select: { id: true, status: true, customerId: true },
    });
    if (!order) return badRequest("Selected sales order does not exist or is archived.");
    if (!["confirmed", "processing", "completed"].includes(order.status)) {
      return badRequest(`Cannot invoice a ${order.status} sales order.`);
    }
    if (order.customerId !== existing.customerId) {
      return badRequest("Sales order/customer mismatch.");
    }
  }

  // --- Due date after issue date ---
  const newIssue = d.issueDate ? new Date(d.issueDate) : existing.issueDate;
  const newDue = d.dueDate ? new Date(d.dueDate) : existing.dueDate;
  if (newDue <= newIssue) {
    return badRequest("Due date must be after the issue date.");
  }

  const data: Record<string, unknown> = { updatedById: auth.ctx.userId };
  if (d.projectId !== undefined) data.projectId = d.projectId || null;
  if (d.salesOrderId !== undefined) data.salesOrderId = d.salesOrderId || null;
  if (d.issueDate !== undefined) data.issueDate = new Date(d.issueDate);
  if (d.dueDate !== undefined) data.dueDate = new Date(d.dueDate);
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;
  if (d.terms !== undefined) data.terms = d.terms?.trim() || null;

  const updated = await db.$transaction(async (tx) => {
    const u = await tx.invoice.update({ where: { id }, data });
    // Recompute invoice totals (server-side authoritative).
    const totals = await recomputeInvoiceTotals(tx, id);
    // Recompute balance (defensive — no posted payments expected on a draft).
    const bal = await recomputeInvoiceBalance(tx, id);
    const finalInv = await tx.invoice.update({
      where: { id },
      data: {
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        amountPaid: bal?.amountPaid ?? "0",
        balanceDue: bal?.balanceDue ?? totals.total,
      },
      include: {
        customer: {
          select: { id: true, customerNumber: true, tradingName: true, legalName: true },
        },
        items: { orderBy: { createdAt: "asc" } },
      },
    });
    return { finalInv, totals, bal };
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "sales",
    recordId: updated.finalInv.id,
    recordType: "Invoice",
    description: `Updated invoice ${updated.finalInv.invoiceNumber}`,
    previousValue: existing,
    newValue: { ...updated.finalInv, totals: updated.totals },
  });

  return ok(updated.finalInv);
}
