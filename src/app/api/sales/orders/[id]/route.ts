// ============================================================================
// LBMS Phase 10 API — Sales Order single-record
// ----------------------------------------------------------------------------
// GET   /api/sales/orders/[id]   fetch one SO with items + customer + project.
//   Requires `sales:view`.
// PATCH /api/sales/orders/[id]   edit a DRAFT SO only. orderNumber + customerId
//   immutable. Recomputes totals server-side. Requires `sales:edit`.
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
  ORDER_TERMINAL,
  recomputeOrderTotals,
} from "@/lib/sales-utils";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const PatchOrderSchema = z.object({
  projectId: z.string().nullable().optional(),
  orderDate: dateString.optional(),
  notes: z.string().max(5000).optional(),
});

const PROJECT_TERMINAL = new Set(["completed", "cancelled"]);

// ---------------------------------------------------------------------------
// GET /api/sales/orders/[id]
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const order = await db.salesOrder.findFirst({
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
      quote: { select: { id: true, quoteNumber: true, status: true } },
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
      invoices: {
        select: { id: true, invoiceNumber: true, status: true, total: true, balanceDue: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!order) return notFound("Sales order not found.");

  return ok(order);
}

// ---------------------------------------------------------------------------
// PATCH /api/sales/orders/[id]
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.salesOrder.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Sales order not found.");

  if (existing.status !== "draft") {
    if (ORDER_TERMINAL.has(existing.status)) {
      return badRequest(`Cannot edit a ${existing.status} sales order.`);
    }
    return badRequest(
      `Cannot edit a ${existing.status} sales order. Only draft orders may be edited.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = PatchOrderSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  if (d.projectId !== undefined && d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true, status: true },
    });
    if (!project) return badRequest("Selected project does not exist or is archived.");
    if (PROJECT_TERMINAL.has(project.status)) {
      return badRequest(`Cannot link a sales order against a ${project.status} project.`);
    }
  }

  const data: Record<string, unknown> = { updatedById: auth.ctx.userId };
  if (d.projectId !== undefined) data.projectId = d.projectId || null;
  if (d.orderDate !== undefined) data.orderDate = new Date(d.orderDate);
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;

  const updated = await db.$transaction(async (tx) => {
    const u = await tx.salesOrder.update({ where: { id }, data });
    const totals = await recomputeOrderTotals(tx, id);
    const finalO = await tx.salesOrder.update({
      where: { id },
      data: {
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
      },
      include: {
        customer: {
          select: { id: true, customerNumber: true, tradingName: true, legalName: true },
        },
        project: { select: { id: true, projectNumber: true, name: true } },
        items: { orderBy: { createdAt: "asc" } },
      },
    });
    return { finalO, totals };
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "sales",
    recordId: updated.finalO.id,
    recordType: "SalesOrder",
    description: `Updated sales order ${updated.finalO.orderNumber}`,
    previousValue: existing,
    newValue: { ...updated.finalO, totals: updated.totals },
  });

  return ok(updated.finalO);
}
