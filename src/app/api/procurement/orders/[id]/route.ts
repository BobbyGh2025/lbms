// ============================================================================
// LBMS Phase 7 API — Purchase Order single-record
// ----------------------------------------------------------------------------
// GET   /api/procurement/orders/[id]   fetch one PO with supplier, project,
//   items, request, approver, receipts. Requires `procurement:view`.
// PATCH /api/procurement/orders/[id]   edit a DRAFT/pending_approval PO.
//   purchaseOrderNumber + supplierId are immutable. Edits blocked once sent.
//   Requires `procurement:edit`. Audit with prev+new.
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
import { PO_TERMINAL_STATUSES } from "@/lib/procurement-utils";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const PatchPOSchema = z.object({
  projectId: z.string().nullable().optional(),
  expectedDeliveryDate: dateString.nullable().optional(),
  orderDate: dateString.optional(),
  notes: z.string().max(5000).optional(),
});

const PROJECT_TERMINAL = new Set(["completed", "cancelled"]);

// ---------------------------------------------------------------------------
// GET /api/procurement/orders/[id]
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("procurement", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const po = await db.purchaseOrder.findFirst({
    where: { id, ...notDeleted() },
    include: {
      supplier: {
        select: {
          id: true, supplierNumber: true, tradingName: true, legalName: true,
          email: true, phone: true, status: true, country: true, city: true,
        },
      },
      project: { select: { id: true, projectNumber: true, name: true, status: true } },
      procurementRequest: {
        select: { id: true, requestNumber: true, title: true, status: true },
      },
      requestedBy: { select: { id: true, username: true } },
      approvedBy: { select: { id: true, username: true } },
      createdBy: { select: { id: true, username: true } },
      items: {
        orderBy: { createdAt: "asc" },
      },
      goodsReceipts: {
        orderBy: { receiptDate: "desc" },
        include: {
          receivedBy: { select: { id: true, username: true } },
          items: true,
        },
      },
    },
  });
  if (!po) return notFound("Purchase order not found.");

  return ok(po);
}

// ---------------------------------------------------------------------------
// PATCH /api/procurement/orders/[id]
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("procurement", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.purchaseOrder.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Purchase order not found.");

  // Block edits once the PO has been sent or is in a terminal state.
  if (PO_TERMINAL_STATUSES.has(existing.status) || existing.status === "sent") {
    return badRequest(
      `Cannot edit a ${existing.status} purchase order.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = PatchPOSchema.safeParse(body);
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
      return badRequest(`Cannot link a purchase order against a ${project.status} project.`);
    }
  }

  const data: Record<string, unknown> = { updatedById: auth.ctx.userId };
  if (d.projectId !== undefined) data.projectId = d.projectId || null;
  if (d.expectedDeliveryDate !== undefined) {
    data.expectedDeliveryDate = d.expectedDeliveryDate ? new Date(d.expectedDeliveryDate) : null;
  }
  if (d.orderDate !== undefined) data.orderDate = new Date(d.orderDate);
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;

  const updated = await db.purchaseOrder.update({
    where: { id },
    data,
    include: {
      supplier: { select: { id: true, supplierNumber: true, tradingName: true, legalName: true } },
      project: { select: { id: true, projectNumber: true, name: true } },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "procurement",
    recordId: updated.id,
    recordType: "PurchaseOrder",
    description: `Updated purchase order ${updated.purchaseOrderNumber}`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
