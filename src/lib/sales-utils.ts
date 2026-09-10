// ============================================================================
// LBMS Phase 10 — Sales Helpers
// ----------------------------------------------------------------------------
// Shared utilities for Phase 10 Sales API routes:
//   • Reference number generation (QT/SO/INV/PMT-YYYY-NNNNNN)
//   • Lifecycle transition graphs
//   • Server-side totals recompute (never trusts client)
//   • Balance due calculation (invoice.total − Σ posted payments)
// ============================================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { toMoney, roundMoney, serializeMoney, ZERO, type Money } from "@/lib/finance/money";

type TransactionClient = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// Reference number generation
// ---------------------------------------------------------------------------

export async function nextSalesRefNumber(
  tx: TransactionClient,
  prefix: string,
  year: number,
): Promise<string> {
  const counter = await tx.salesRefCounter.upsert({
    where: { prefix_year: { prefix, year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix, year, nextNumber: 1 },
  });
  return `${prefix}-${year}-${String(counter.nextNumber).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Lifecycle enums + transitions
// ---------------------------------------------------------------------------

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected", "expired", "converted", "cancelled"] as const;
export const QUOTE_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["sent", "cancelled"],
  sent: ["accepted", "rejected", "cancelled"],
  accepted: ["converted", "cancelled"],
  rejected: [],
  expired: [],
  converted: [],
  cancelled: [],
};
export function isValidQuoteTransition(from: string, to: string): boolean {
  return (QUOTE_TRANSITIONS[from] ?? []).includes(to);
}

export const SALES_ORDER_STATUSES = ["draft", "confirmed", "processing", "completed", "cancelled"] as const;
export const SALES_ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["processing", "completed", "cancelled"],
  processing: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};
export function isValidOrderTransition(from: string, to: string): boolean {
  return (SALES_ORDER_TRANSITIONS[from] ?? []).includes(to);
}

export const INVOICE_STATUSES = ["draft", "issued", "partially_paid", "paid", "voided"] as const;
export const INVOICE_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["issued", "voided"],
  issued: ["partially_paid", "paid", "voided"],
  partially_paid: ["paid", "voided"],
  paid: ["voided"],
  voided: [],
};
export function isValidInvoiceTransition(from: string, to: string): boolean {
  return (INVOICE_TRANSITIONS[from] ?? []).includes(to);
}

export const PAYMENT_STATUSES = ["draft", "posted", "voided"] as const;
export const PAYMENT_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["posted"],
  posted: ["voided"],
  voided: [],
};

/** Terminal states — general PATCH blocked. */
export const QUOTE_TERMINAL = new Set(["rejected", "expired", "converted", "cancelled"]);
export const ORDER_TERMINAL = new Set(["completed", "cancelled"]);
export const INVOICE_TERMINAL = new Set(["paid", "voided"]);
export const PAYMENT_TERMINAL = new Set(["voided"]);

// ---------------------------------------------------------------------------
// Item totals computation (server-side, never trusts client)
// ---------------------------------------------------------------------------

export function computeItemLineTotal(input: {
  quantity: string | number | Money;
  unitPrice: string | number | Money;
  discount?: string | number | Money;
  taxRate?: string | number | Money;
}): { subtotal: Money; discount: Money; tax: Money; total: Money } {
  const qty = roundMoney(toMoney(input.quantity));
  const price = roundMoney(toMoney(input.unitPrice));
  const discount = roundMoney(toMoney(input.discount ?? 0));
  const rate = roundMoney(toMoney(input.taxRate ?? 0));
  const gross = qty.times(price);
  const lineSubtotal = gross.minus(discount).lt(0) ? ZERO : gross.minus(discount);
  const tax = lineSubtotal.times(rate).div(100);
  const total = lineSubtotal.plus(tax);
  return {
    subtotal: roundMoney(gross),
    discount: roundMoney(discount),
    tax: roundMoney(tax),
    total: roundMoney(total),
  };
}

// ---------------------------------------------------------------------------
// Document totals recompute
// ---------------------------------------------------------------------------

export async function recomputeQuoteTotals(tx: TransactionClient, quoteId: string) {
  const items = await tx.quoteItem.findMany({ where: { quoteId }, select: { quantity: true, unitPrice: true, discount: true, taxRate: true, tax: true, total: true } });
  let subtotal = ZERO, tax = ZERO, total = ZERO;
  for (const item of items) {
    const computed = computeItemLineTotal({ quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount, taxRate: item.taxRate });
    subtotal = subtotal.plus(computed.subtotal);
    tax = tax.plus(computed.tax);
    total = total.plus(computed.total);
  }
  return { subtotal: serializeMoney(subtotal), tax: serializeMoney(tax), total: serializeMoney(total) };
}

export async function recomputeOrderTotals(tx: TransactionClient, orderId: string) {
  const items = await tx.salesOrderItem.findMany({ where: { salesOrderId: orderId }, select: { quantity: true, unitPrice: true, discount: true, taxRate: true, tax: true, total: true } });
  let subtotal = ZERO, tax = ZERO, total = ZERO;
  for (const item of items) {
    const computed = computeItemLineTotal({ quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount, taxRate: item.taxRate });
    subtotal = subtotal.plus(computed.subtotal);
    tax = tax.plus(computed.tax);
    total = total.plus(computed.total);
  }
  return { subtotal: serializeMoney(subtotal), tax: serializeMoney(tax), total: serializeMoney(total) };
}

export async function recomputeInvoiceTotals(tx: TransactionClient, invoiceId: string) {
  const items = await tx.invoiceItem.findMany({ where: { invoiceId }, select: { quantity: true, unitPrice: true, discount: true, taxRate: true, tax: true, total: true } });
  let subtotal = ZERO, tax = ZERO, total = ZERO;
  for (const item of items) {
    const computed = computeItemLineTotal({ quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount, taxRate: item.taxRate });
    subtotal = subtotal.plus(computed.subtotal);
    tax = tax.plus(computed.tax);
    total = total.plus(computed.total);
  }
  return { subtotal: serializeMoney(subtotal), tax: serializeMoney(tax), total: serializeMoney(total) };
}

// ---------------------------------------------------------------------------
// Invoice balance + payment recompute
// ---------------------------------------------------------------------------

export async function recomputeInvoiceBalance(tx: TransactionClient, invoiceId: string) {
  const [invoice, payments] = await Promise.all([
    tx.invoice.findUnique({ where: { id: invoiceId }, select: { total: true } }),
    tx.customerPayment.findMany({ where: { invoiceId, status: "posted" }, select: { amount: true } }),
  ]);
  if (!invoice) return null;
  const total = toMoney(invoice.total);
  let paid = ZERO;
  for (const p of payments) paid = paid.plus(toMoney(p.amount));
  const balance = total.minus(paid).lt(0) ? ZERO : total.minus(paid);
  return {
    amountPaid: serializeMoney(paid),
    balanceDue: serializeMoney(balance),
    total: serializeMoney(total),
  };
}

/** Determine if an invoice is overdue (derived, not stored). */
export function isInvoiceOverdue(invoice: { dueDate: Date; balanceDue: any; status: string }): boolean {
  if (invoice.status === "voided" || invoice.status === "paid") return false;
  const balance = toMoney(invoice.balanceDue);
  if (balance.lte(0)) return false;
  return new Date(invoice.dueDate) < new Date();
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateQuantity(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid quantity: "${value}"`);
  const d = toMoney(s);
  if (d.lte(0)) throw new Error(`Quantity must be greater than zero (received ${s}).`);
  if (d.gt(1_000_000_000)) throw new Error(`Quantity exceeds maximum (received ${s}).`);
  return serializeMoney(d);
}

export function validateUnitPrice(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid unit price: "${value}"`);
  const d = toMoney(s);
  if (d.lt(0)) throw new Error(`Unit price cannot be negative (received ${s}).`);
  if (d.gt(1_000_000_000)) throw new Error(`Unit price exceeds maximum (received ${s}).`);
  return serializeMoney(d);
}

export function validateTaxRate(value: unknown): string {
  const s = String(value ?? "0").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid tax rate: "${value}"`);
  const d = toMoney(s);
  if (d.lt(0) || d.gt(100)) throw new Error(`Tax rate must be between 0 and 100 (received ${s}).`);
  return serializeMoney(d);
}

export function validateDiscount(value: unknown, maxAmount?: Money): string {
  const s = String(value ?? "0").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid discount: "${value}"`);
  const d = toMoney(s);
  if (d.lt(0)) throw new Error(`Discount cannot be negative (received ${s}).`);
  if (maxAmount && d.gt(maxAmount)) throw new Error(`Discount (${s}) exceeds subtotal (${serializeMoney(maxAmount)}).`);
  return serializeMoney(d);
}
