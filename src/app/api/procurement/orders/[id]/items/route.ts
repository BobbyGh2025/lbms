// ============================================================================
// LBMS Phase 7 API — Purchase Order Items collection
// ----------------------------------------------------------------------------
// GET  /api/procurement/orders/[id]/items   list items for a PO. Requires
//   `procurement:view`.
// POST /api/procurement/orders/[id]/items   add a line item to a PO. Only
//   allowed before sending (draft/pending_approval/approved). Validates
//   quantity >= 0, unitPrice >= 0, taxRate 0–100. Server-calculates tax +
//   total. Recomputes PO subtotal/tax/total. Requires `procurement:edit`.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import {
  computeItemTotals,
  recomputePurchaseOrderTotals,
  validateQuantity,
  validateUnitPrice,
  validateTaxRate,
  PO_ITEM_EDITABLE_STATUSES,
} from "@/lib/procurement-utils";

// ---------------------------------------------------------------------------
// GET /api/procurement/orders/[id]/items
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
    select: { id: true, purchaseOrderNumber: true, status: true },
  });
  if (!po) return notFound("Purchase order not found.");

  const items = await db.purchaseOrderItem.findMany({
    where: { purchaseOrderId: id },
    orderBy: { createdAt: "asc" },
  });

  return ok({ purchaseOrder: po, items });
}

// ---------------------------------------------------------------------------
// POST /api/procurement/orders/[id]/items
// ---------------------------------------------------------------------------
const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, "Must be a positive decimal string");

const CreateItemSchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  quantity: decimalString,
  unitPrice: decimalString,
  taxRate: decimalString.optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("procurement", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const po = await db.purchaseOrder.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, purchaseOrderNumber: true, status: true },
  });
  if (!po) return notFound("Purchase order not found.");

  if (!PO_ITEM_EDITABLE_STATUSES.has(po.status)) {
    return badRequest(
      `Cannot add items to a ${po.status} purchase order. Items may only be added before sending.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateItemSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Validate quantity / unitPrice / taxRate (reject negatives).
  let qtyStr: string, priceStr: string, taxRateStr: string;
  try {
    qtyStr = validateQuantity(d.quantity);
    priceStr = validateUnitPrice(d.unitPrice);
    taxRateStr = validateTaxRate(d.taxRate ?? "0");
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Invalid quantity/price/taxRate.");
  }

  // Server-side total computation (never trust client).
  const totals = computeItemTotals({
    quantity: qtyStr,
    unitPrice: priceStr,
    taxRate: taxRateStr,
  });

  try {
    const created = await db.$transaction(async (tx) => {
      const item = await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId: id,
          description: d.description.trim(),
          quantity: qtyStr,
          unitPrice: priceStr,
          taxRate: taxRateStr,
          tax: totals.tax.toString(),
          total: totals.total.toString(),
        },
      });

      // Recompute PO totals from all active items.
      const poTotals = await recomputePurchaseOrderTotals(tx, id);
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          subtotal: poTotals.subtotal,
          tax: poTotals.tax,
          total: poTotals.total,
          updatedById: auth.ctx.userId,
        },
      });

      return { item, poTotals };
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "procurement",
      recordId: created.item.id,
      recordType: "PurchaseOrderItem",
      description: `Added item to PO ${po.purchaseOrderNumber}: ${d.description} (qty ${qtyStr} × ${priceStr})`,
      newValue: { item: created.item, poTotals: created.poTotals },
    });

    return ok(created, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A constraint error occurred. Please retry.");
    }
    throw err;
  }
}
