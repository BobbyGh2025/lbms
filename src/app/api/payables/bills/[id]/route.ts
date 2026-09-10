// ============================================================================
// LBMS Phase 11 API — Supplier Bill single-record
// ----------------------------------------------------------------------------
// GET   /api/payables/bills/[id]   fetch one bill with items + supplier + payments
//   + project. Derives `overdue` flag.
// PATCH /api/payables/bills/[id]   edit a DRAFT bill only. billNumber + supplierId
//   immutable. Recomputes totals + balance. Requires `payables:edit`.
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
  BILL_TERMINAL,
  recomputeBillTotals,
  recomputeBillBalance,
  isBillOverdue,
} from "@/lib/ap-utils";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const PatchBillSchema = z.object({
  supplierRef: z.string().max(200).nullable().optional(),
  projectId: z.string().nullable().optional(),
  billDate: dateString.optional(),
  dueDate: dateString.nullable().optional(),
  notes: z.string().max(5000).optional(),
});

const PROJECT_TERMINAL = new Set(["completed", "cancelled"]);

// ---------------------------------------------------------------------------
// GET /api/payables/bills/[id]
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("payables", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const bill = await db.supplierBill.findFirst({
    where: { id, ...notDeleted() },
    include: {
      supplier: {
        select: {
          id: true, supplierNumber: true, tradingName: true, legalName: true,
          email: true, phone: true, status: true, country: true, city: true,
        },
      },
      project: { select: { id: true, projectNumber: true, name: true, status: true } },
      createdBy: { select: { id: true, username: true } },
      updatedBy: { select: { id: true, username: true } },
      approvedBy: { select: { id: true, username: true } },
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
          voidedBy: { select: { id: true, username: true } },
        },
      },
    },
  });
  if (!bill) return notFound("Supplier bill not found.");

  return ok({
    ...bill,
    overdue: isBillOverdue({
      dueDate: bill.dueDate,
      balanceDue: bill.balanceDue,
      status: bill.status,
    }),
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/payables/bills/[id]
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("payables", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.supplierBill.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, billNumber: true, status: true, supplierId: true },
  });
  if (!existing) return notFound("Supplier bill not found.");

  if (existing.status !== "draft") {
    if (BILL_TERMINAL.has(existing.status)) {
      return badRequest(`Cannot edit a ${existing.status} bill.`);
    }
    return badRequest(
      `Cannot edit a ${existing.status} bill. Only draft bills may be edited.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = PatchBillSchema.safeParse(body);
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
      return badRequest(`Cannot link a bill against a ${project.status} project.`);
    }
  }

  const data: Record<string, unknown> = { updatedById: auth.ctx.userId };
  if (d.supplierRef !== undefined) data.supplierRef = d.supplierRef?.trim() || null;
  if (d.projectId !== undefined) data.projectId = d.projectId || null;
  if (d.billDate !== undefined) data.billDate = new Date(d.billDate);
  if (d.dueDate !== undefined) data.dueDate = d.dueDate ? new Date(d.dueDate) : null;
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;

  const updated = await db.$transaction(async (tx) => {
    const u = await tx.supplierBill.update({ where: { id }, data });
    // Recompute bill totals (server-side authoritative).
    const totals = await recomputeBillTotals(tx, id);
    const bal = await recomputeBillBalance(tx, id);
    const finalBill = await tx.supplierBill.update({
      where: { id },
      data: {
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        amountPaid: bal?.amountPaid ?? "0",
        balanceDue: bal?.balanceDue ?? totals.total,
      },
      include: {
        supplier: {
          select: { id: true, supplierNumber: true, tradingName: true, legalName: true },
        },
        items: { orderBy: { createdAt: "asc" } },
      },
    });
    return { finalBill, totals, bal };
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "payables",
    recordId: updated.finalBill.id,
    recordType: "SupplierBill",
    description: `Updated supplier bill ${updated.finalBill.billNumber}`,
    previousValue: { status: existing.status, supplierId: existing.supplierId },
    newValue: { ...updated.finalBill, totals: updated.totals },
  });

  return ok(updated.finalBill);
}
