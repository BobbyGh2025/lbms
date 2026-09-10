// ============================================================================
// LBMS Phase 10 API — Quote convert to Sales Order
// ----------------------------------------------------------------------------
// POST /api/sales/quotes/[id]/convert
//   Transition: accepted → converted. Idempotent: if `convertedToSalesOrderId`
//   is already set, returns the existing linked SalesOrder (200, no audit
//   re-write). Otherwise creates a new SalesOrder (SO-YYYY-NNNNNN), copies
//   all quote items into SalesOrderItem rows (server-side line totals
//   re-computed), sets quote.convertedToSalesOrderId + convertedAt, marks
//   the quote as `converted` (terminal). Requires `sales:create`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, badRequest, notFound, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import {
  nextSalesRefNumber,
  recomputeOrderTotals,
  recomputeQuoteTotals,
  isValidQuoteTransition,
  computeItemLineTotal,
} from "@/lib/sales-utils";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "create");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const quote = await db.quote.findFirst({
    where: { id, ...notDeleted() },
    include: {
      items: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!quote) return notFound("Quote not found.");

  // Idempotent: if quote already converted, return the linked order.
  if (quote.convertedToSalesOrderId) {
    const existingOrder = await db.salesOrder.findFirst({
      where: { id: quote.convertedToSalesOrderId, ...notDeleted() },
      include: {
        customer: {
          select: { id: true, customerNumber: true, tradingName: true, legalName: true },
        },
        items: { orderBy: { createdAt: "asc" } },
      },
    });
    if (existingOrder) {
      return ok(existingOrder);
    }
  }

  // Must be accepted to convert.
  if (!isValidQuoteTransition(quote.status, "converted")) {
    return badRequest(
      `Cannot convert a ${quote.status} quote. Only accepted quotes may be converted.`,
    );
  }

  // Quote must have at least one item.
  if (quote.items.length === 0) {
    return badRequest("Cannot convert a quote with no line items.");
  }

  const year = new Date().getFullYear();

  try {
    const result = await db.$transaction(async (tx) => {
      const orderNumber = await nextSalesRefNumber(tx, "SO", year);

      // Create the SalesOrder header.
      const order = await tx.salesOrder.create({
        data: {
          orderNumber,
          customerId: quote.customerId,
          quoteId: quote.id,
          projectId: quote.projectId,
          orderDate: new Date(),
          status: "draft",
          notes: quote.notes ?? null,
          createdById: auth.ctx.userId,
          updatedById: auth.ctx.userId,
        },
      });

      // Copy each quote item into a SalesOrderItem (recompute totals server-side).
      for (const qi of quote.items) {
        const lineTotals = computeItemLineTotal({
          quantity: qi.quantity,
          unitPrice: qi.unitPrice,
          discount: qi.discount,
          taxRate: qi.taxRate,
        });
        await tx.salesOrderItem.create({
          data: {
            salesOrderId: order.id,
            inventoryItemId: qi.inventoryItemId ?? null,
            description: qi.description,
            quantity: qi.quantity.toString(),
            unitPrice: qi.unitPrice.toString(),
            discount: qi.discount.toString(),
            taxRate: qi.taxRate.toString(),
            tax: lineTotals.tax.toString(),
            total: lineTotals.total.toString(),
          },
        });
      }

      // Recompute order totals from items (server-side authoritative).
      const orderTotals = await recomputeOrderTotals(tx, order.id);
      const finalOrder = await tx.salesOrder.update({
        where: { id: order.id },
        data: {
          subtotal: orderTotals.subtotal,
          tax: orderTotals.tax,
          total: orderTotals.total,
        },
        include: {
          customer: {
            select: { id: true, customerNumber: true, tradingName: true, legalName: true },
          },
          items: { orderBy: { createdAt: "asc" } },
        },
      });

      // Mark quote as converted (terminal) + link back.
      const now = new Date();
      const updatedQuote = await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: "converted",
          convertedAt: now,
          convertedToSalesOrderId: order.id,
          updatedById: auth.ctx.userId,
        },
      });

      // Recompute quote totals (defensive — should be unchanged).
      const quoteTotals = await recomputeQuoteTotals(tx, quote.id);

      return { finalOrder, updatedQuote, orderTotals, quoteTotals, now };
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "sales",
      recordId: result.finalOrder.id,
      recordType: "SalesOrder",
      description: `Converted quote ${quote.quoteNumber} → sales order ${result.finalOrder.orderNumber}`,
      newValue: {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        salesOrderId: result.finalOrder.id,
        orderNumber: result.finalOrder.orderNumber,
        itemCount: quote.items.length,
        orderTotal: result.orderTotals.total,
      },
    });

    return ok(result.finalOrder, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A race condition occurred while assigning the order number. Please retry.");
    }
    throw err;
  }
}
