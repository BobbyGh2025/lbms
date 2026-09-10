// ============================================================================
// LBMS Phase 7 API — Goods Receiving
// ----------------------------------------------------------------------------
// GET  /api/procurement/orders/[id]/receiving   list goods receipts for a PO.
//   Requires `procurement:view`.
// POST /api/procurement/orders/[id]/receiving   record a receipt (partial or
//   full). Body: { receiptDate?, notes?, items: [{ purchaseOrderItemId,
//   receivedQuantity, notes? }] }. The PO must be in sent/partially_received
//   status. Over-receipt is rejected (receivedQuantity would exceed ordered
//   quantity − already received). Auto-advances PO status to
//   partially_received or received. Auto-advances each item status. Requires
//   `procurement:receive`.
//
// FINANCE BOUNDARY: Receiving does NOT create a journal entry. It records
// the operational fact that goods arrived. The financial handoff (AP bill)
// is deferred to a future phase.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import {
  nextGoodsReceiptNumber,
  recomputePurchaseOrderTotals,
  isValidPurchaseOrderTransition,
} from "@/lib/procurement-utils";
import { toMoney, serializeMoney } from "@/lib/finance/money";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, "Must be a positive decimal string");

const ReceiveItemSchema = z.object({
  purchaseOrderItemId: z.string().min(1),
  receivedQuantity: decimalString,
  notes: z.string().max(500).optional(),
});

const ReceiveSchema = z.object({
  receiptDate: dateString.optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(ReceiveItemSchema).min(1, "At least one item is required to record a receipt."),
});

/** PO statuses in which receiving is permitted. */
const PO_RECEIVABLE_STATUSES = new Set(["sent", "partially_received"]);

// ---------------------------------------------------------------------------
// GET /api/procurement/orders/[id]/receiving
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

  const receipts = await db.goodsReceipt.findMany({
    where: { purchaseOrderId: id },
    orderBy: { receiptDate: "desc" },
    include: {
      receivedBy: { select: { id: true, username: true } },
      items: { include: { purchaseOrderItem: { select: { description: true } } } },
    },
  });

  return ok({ purchaseOrder: po, receipts });
}

// ---------------------------------------------------------------------------
// POST /api/procurement/orders/[id]/receiving
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("procurement", "receive");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const po = await db.purchaseOrder.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, purchaseOrderNumber: true, status: true, supplierId: true },
  });
  if (!po) return notFound("Purchase order not found.");

  if (!PO_RECEIVABLE_STATUSES.has(po.status)) {
    return badRequest(
      `Cannot receive against a ${po.status} purchase order. Only sent or partially_received POs may be received.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }
  const parsed = ReceiveSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Load all PO items (active, non-cancelled) for validation.
  const poItems = await db.purchaseOrderItem.findMany({
    where: { purchaseOrderId: id, status: { not: "cancelled" } },
    select: { id: true, description: true, quantity: true, receivedQuantity: true },
  });
  const itemMap = new Map(poItems.map((i) => [i.id, i]));

  // Validate each receipt line.
  for (const line of d.items) {
    const item = itemMap.get(line.purchaseOrderItemId);
    if (!item) {
      return badRequest(`Item ${line.purchaseOrderItemId} does not belong to this purchase order.`);
    }
    const orderedQty = toMoney(item.quantity);
    const alreadyReceived = toMoney(item.receivedQuantity);
    const thisReceipt = toMoney(line.receivedQuantity);
    const newTotal = alreadyReceived.plus(thisReceipt);
    if (newTotal.gt(orderedQty)) {
      return badRequest(
        `Over-receipt rejected for "${item.description}": ordered ${serializeMoney(orderedQty)}, already received ${serializeMoney(alreadyReceived)}, this receipt ${serializeMoney(thisReceipt)} would total ${serializeMoney(newTotal)}.`,
      );
    }
    if (thisReceipt.lte(0)) {
      return badRequest(`Received quantity for "${item.description}" must be greater than zero.`);
    }
  }

  const year = new Date().getFullYear();

  try {
    const result = await db.$transaction(async (tx) => {
      const receiptNumber = await nextGoodsReceiptNumber(tx, year);

      // Create the goods receipt header.
      const receipt = await tx.goodsReceipt.create({
        data: {
          receiptNumber,
          purchaseOrderId: id,
          supplierId: po.supplierId,
          receivedById: auth.ctx.userId,
          receiptDate: d.receiptDate ? new Date(d.receiptDate) : new Date(),
          notes: d.notes?.trim() || null,
          createdById: auth.ctx.userId,
        },
      });

      // Create receipt lines + update item receivedQuantity + status.
      let allFullyReceived = true;
      for (const line of d.items) {
        const item = itemMap.get(line.purchaseOrderItemId)!;
        const newReceivedQty = toMoney(item.receivedQuantity).plus(toMoney(line.receivedQuantity));

        await tx.goodsReceiptItem.create({
          data: {
            goodsReceiptId: receipt.id,
            purchaseOrderItemId: line.purchaseOrderItemId,
            receivedQuantity: serializeMoney(toMoney(line.receivedQuantity)),
            notes: line.notes?.trim() || null,
          },
        });

        const itemStatus = newReceivedQty.gte(toMoney(item.quantity)) ? "received" : "partially_received";
        if (itemStatus !== "received") allFullyReceived = false;

        await tx.purchaseOrderItem.update({
          where: { id: line.purchaseOrderItemId },
          data: {
            receivedQuantity: serializeMoney(newReceivedQty),
            status: itemStatus,
          },
        });
      }

      // Determine PO status transition.
      const targetStatus = allFullyReceived ? "received" : "partially_received";
      if (!isValidPurchaseOrderTransition(po.status, targetStatus)) {
        // If we're already partially_received and still partial, that's a no-op
        // (same-state). Allow it.
        if (po.status !== targetStatus) {
          throw new Error(`Invalid PO transition ${po.status} → ${targetStatus}`);
        }
      }

      const updatedPO = await tx.purchaseOrder.update({
        where: { id },
        data: { status: targetStatus, updatedById: auth.ctx.userId },
      });

      // Recompute totals (receipts don't change the PO totals, but keep them in sync).
      const poTotals = await recomputePurchaseOrderTotals(tx, id);

      return { receipt, updatedPO, poTotals };
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "procurement",
      recordId: result.receipt.id,
      recordType: "GoodsReceipt",
      description: `Recorded receipt ${result.receipt.receiptNumber} against PO ${po.purchaseOrderNumber} → PO status ${result.updatedPO.status}`,
      newValue: {
        receiptNumber: result.receipt.receiptNumber,
        poStatus: result.updatedPO.status,
        itemCount: d.items.length,
      },
    });

    return ok(result, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A race condition occurred while assigning the receipt number. Please retry.");
    }
    throw err;
  }
}
