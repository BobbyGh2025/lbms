// ============================================================================
// LBMS Phase 7 — Procurement, Supplier Operations & Resource Management Helpers
// ----------------------------------------------------------------------------
// Shared utilities for Phase 7 Procurement API routes:
//   • `nextProcurementRequestNumber` — atomic REQ-YYYY-NNNNNN generation.
//   • `nextPurchaseOrderNumber`      — atomic PO-YYYY-NNNNNN generation.
//   • `nextGoodsReceiptNumber`       — atomic GR-YYYY-NNNNNN generation.
//   • Lifecycle enums + transition graphs for requests, POs and items.
//   • `recomputePurchaseOrderTotals` — server-side total recalculation from
//     line items. NEVER trusts client-supplied totals.
//
// All counters use the ProcurementRefCounter table with the established
// upsert + increment pattern inside `db.$transaction`. The counter is a
// SEPARATE table from Finance/Employee/Relationship/Project/Task counters —
// procurement numbers can never collide with other entities.
//
// FINANCE BOUNDARY: Procurement never touches the Finance posting engine or
// the Journal table. PO totals are *commitments*, not posted liabilities.
// The handoff to AP is deferred to a future phase.
// ============================================================================

import { PrismaClient, Prisma } from "@prisma/client";
import {
  toMoney,
  roundMoney,
  serializeMoney,
  ZERO,
  type Money,
} from "@/lib/finance/money";

/** Transaction client type accepted by the helpers below. */
type TransactionClient =
  | PrismaClient
  | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// Reference number generation
// ---------------------------------------------------------------------------

/**
 * Atomically claim + return the next procurement request number for the
 * given year. Must be called inside a `db.$transaction`. Produces numbers
 * in the form `REQ-<YYYY>-<NNNNNN>` where NNNNNN is zero-padded to 6 digits.
 *
 * Example: `nextProcurementRequestNumber(tx, 2026)` → "REQ-2026-000001"
 */
export async function nextProcurementRequestNumber(
  tx: TransactionClient,
  year: number,
): Promise<string> {
  const counter = await tx.procurementRefCounter.upsert({
    where: { prefix_year: { prefix: "REQ", year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix: "REQ", year, nextNumber: 1 },
  });
  return `REQ-${year}-${String(counter.nextNumber).padStart(6, "0")}`;
}

/**
 * Atomically claim + return the next purchase order number.
 * Produces numbers in the form `PO-<YYYY>-<NNNNNN>`.
 */
export async function nextPurchaseOrderNumber(
  tx: TransactionClient,
  year: number,
): Promise<string> {
  const counter = await tx.procurementRefCounter.upsert({
    where: { prefix_year: { prefix: "PO", year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix: "PO", year, nextNumber: 1 },
  });
  return `PO-${year}-${String(counter.nextNumber).padStart(6, "0")}`;
}

/**
 * Atomically claim + return the next goods receipt number.
 * Produces numbers in the form `GR-<YYYY>-<NNNNNN>`.
 */
export async function nextGoodsReceiptNumber(
  tx: TransactionClient,
  year: number,
): Promise<string> {
  const counter = await tx.procurementRefCounter.upsert({
    where: { prefix_year: { prefix: "GR", year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix: "GR", year, nextNumber: 1 },
  });
  return `GR-${year}-${String(counter.nextNumber).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Procurement Request lifecycle
// ---------------------------------------------------------------------------

export const PROCUREMENT_REQUEST_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "converted",
  "cancelled",
] as const;

export const PROCUREMENT_PRIORITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

/**
 * Valid procurement request lifecycle transitions.
 *   draft     → submitted | cancelled
 *   submitted → approved | rejected | cancelled
 *   approved  → converted | cancelled
 *   rejected  → (terminal)
 *   converted → (terminal)
 *   cancelled → (terminal)
 */
export const PROCUREMENT_REQUEST_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "cancelled"],
  approved: ["converted", "cancelled"],
  rejected: [],
  converted: [],
  cancelled: [],
};

export function isValidRequestTransition(from: string, to: string): boolean {
  const allowed = PROCUREMENT_REQUEST_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

/** Terminal request states — general PATCH is blocked. */
export const REQUEST_TERMINAL_STATUSES = new Set<string>([
  "rejected",
  "converted",
  "cancelled",
]);

/** States in which a request may still be edited (draft) before submission. */
export const REQUEST_EDITABLE_STATUSES = new Set<string>(["draft"]);

// ---------------------------------------------------------------------------
// Purchase Order lifecycle
// ---------------------------------------------------------------------------

export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "partially_received",
  "received",
  "closed",
  "cancelled",
] as const;

/**
 * Valid purchase order lifecycle transitions.
 *   draft              → pending_approval | cancelled
 *   pending_approval   → approved | cancelled (reject = cancel in draft state)
 *   approved           → sent | cancelled
 *   sent               → partially_received | received | cancelled
 *   partially_received → received | closed | cancelled
 *   received           → closed | cancelled
 *   closed             → (terminal)
 *   cancelled          → (terminal)
 */
export const PURCHASE_ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["approved", "cancelled"],
  approved: ["sent", "cancelled"],
  sent: ["partially_received", "received", "cancelled"],
  partially_received: ["received", "closed", "cancelled"],
  received: ["closed", "cancelled"],
  closed: [],
  cancelled: [],
};

export function isValidPurchaseOrderTransition(from: string, to: string): boolean {
  const allowed = PURCHASE_ORDER_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

/** Terminal PO states — general PATCH blocked, item delete blocked. */
export const PO_TERMINAL_STATUSES = new Set<string>(["closed", "cancelled"]);

/** PO states where item additions/edits are allowed (before sending). */
export const PO_ITEM_EDITABLE_STATUSES = new Set<string>([
  "draft",
  "pending_approval",
  "approved",
]);

// ---------------------------------------------------------------------------
// Purchase order item helpers
// ---------------------------------------------------------------------------

export const PO_ITEM_STATUSES = [
  "pending",
  "partially_received",
  "received",
  "cancelled",
] as const;

/**
 * Compute the per-item tax amount, line total and contribution to PO totals.
 * All arithmetic uses Decimal (decimal.js) — never JS Number.
 *
 *   lineSubtotal = quantity × unitPrice
 *   taxAmount    = lineSubtotal × (taxRate / 100)
 *   lineTotal    = lineSubtotal + taxAmount
 *
 * @returns { subtotal, tax, total } as Prisma.Decimal.
 */
export function computeItemTotals(input: {
  quantity: string | number | Money;
  unitPrice: string | number | Money;
  taxRate?: string | number | Money;
}): { subtotal: Money; tax: Money; total: Money } {
  const qty = roundMoney(toMoney(input.quantity));
  const price = roundMoney(toMoney(input.unitPrice));
  const rate = roundMoney(toMoney(input.taxRate ?? 0));
  const subtotal = qty.times(price);
  const tax = subtotal.times(rate).div(100);
  const total = subtotal.plus(tax);
  return {
    subtotal: roundMoney(subtotal),
    tax: roundMoney(tax),
    total: roundMoney(total),
  };
}

/**
 * Server-side recompute of a purchase order's subtotal/tax/total from its
 * line items. Called after every item add/update/delete. Mutates nothing on
 * the DB — returns the computed values; the caller persists them inside the
 * same transaction.
 */
export async function recomputePurchaseOrderTotals(
  tx: TransactionClient,
  purchaseOrderId: string,
): Promise<{ subtotal: string; tax: string; total: string; itemCount: number }> {
  const items = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId, status: { not: "cancelled" } },
    select: { quantity: true, unitPrice: true, taxRate: true, tax: true, total: true },
  });

  let subtotal: Money = ZERO;
  let tax: Money = ZERO;
  let total: Money = ZERO;
  for (const item of items) {
    const computed = computeItemTotals({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate,
    });
    subtotal = subtotal.plus(computed.subtotal);
    tax = tax.plus(computed.tax);
    total = total.plus(computed.total);
  }
  return {
    subtotal: serializeMoney(subtotal),
    tax: serializeMoney(tax),
    total: serializeMoney(total),
    itemCount: items.length,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers — quantity / price guards
// ---------------------------------------------------------------------------

/** Reject negative, non-numeric, or excessively large quantities.
 *  Upper bound: 1,000,000,000 (1 billion) — prevents unrealistic values
 *  that would produce totals in scientific notation, breaking the UI. */
export function validateQuantity(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid quantity: "${value}"`);
  }
  const d = toMoney(s);
  if (d.lt(0)) {
    throw new Error(`Quantity cannot be negative (received ${s}).`);
  }
  if (d.gt(1_000_000_000)) {
    throw new Error(`Quantity exceeds maximum allowed value of 1,000,000,000 (received ${s}).`);
  }
  return serializeMoney(d);
}

/** Reject negative, non-numeric, or excessively large unit prices.
 *  Upper bound: 1,000,000,000 (1 billion) — prevents unrealistic values. */
export function validateUnitPrice(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid unit price: "${value}"`);
  }
  const d = toMoney(s);
  if (d.lt(0)) {
    throw new Error(`Unit price cannot be negative (received ${s}).`);
  }
  if (d.gt(1_000_000_000)) {
    throw new Error(`Unit price exceeds maximum allowed value of 1,000,000,000 (received ${s}).`);
  }
  return serializeMoney(d);
}

/** Tax rate must be 0–100 inclusive. */
export function validateTaxRate(value: unknown): string {
  const s = String(value ?? "0").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid tax rate: "${value}"`);
  }
  const d = toMoney(s);
  if (d.lt(0) || d.gt(100)) {
    throw new Error(`Tax rate must be between 0 and 100 (received ${s}).`);
  }
  return serializeMoney(d);
}
