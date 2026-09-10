// ============================================================================
// LBMS Phase 11 — Accounts Payable & Expense Helpers
// ----------------------------------------------------------------------------
// Shared utilities for Phase 11 AP/Expense API routes:
//   • Reference number generation (SB/SP/EXP-YYYY-NNNNNN)
//   • Lifecycle transition graphs
//   • Server-side totals recompute + balance calc
// ============================================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { toMoney, roundMoney, serializeMoney, ZERO, type Money } from "@/lib/finance/money";

type TransactionClient = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// Reference number generation
// ---------------------------------------------------------------------------

export async function nextPayableRefNumber(
  tx: TransactionClient,
  prefix: string,
  year: number,
): Promise<string> {
  const counter = await tx.payableRefCounter.upsert({
    where: { prefix_year: { prefix, year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix, year, nextNumber: 1 },
  });
  return `${prefix}-${year}-${String(counter.nextNumber).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Lifecycle enums + transitions
// ---------------------------------------------------------------------------

export const BILL_STATUSES = ["draft", "submitted", "approved", "posted", "partially_paid", "paid", "voided"] as const;
export const BILL_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["submitted", "voided"],
  submitted: ["approved", "voided"],
  approved: ["posted", "voided"],
  posted: ["partially_paid", "paid", "voided"],
  partially_paid: ["paid", "voided"],
  paid: ["voided"],
  voided: [],
};
export function isValidBillTransition(from: string, to: string): boolean {
  return (BILL_TRANSITIONS[from] ?? []).includes(to);
}
export const BILL_TERMINAL = new Set(["paid", "voided"]);

export const SUPPLIER_PAYMENT_STATUSES = ["draft", "posted", "voided"] as const;
export const SUPPLIER_PAYMENT_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["posted"],
  posted: ["voided"],
  voided: [],
};

export const EXPENSE_STATUSES = ["draft", "submitted", "approved", "posted", "voided"] as const;
export const EXPENSE_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["submitted", "voided"],
  submitted: ["approved", "voided"],
  approved: ["posted", "voided"],
  posted: ["voided"],
  voided: [],
};
export function isValidExpenseTransition(from: string, to: string): boolean {
  return (EXPENSE_TRANSITIONS[from] ?? []).includes(to);
}
export const EXPENSE_TERMINAL = new Set(["posted", "voided"]);

// ---------------------------------------------------------------------------
// Supplier bill totals + balance
// ---------------------------------------------------------------------------

export async function recomputeBillTotals(tx: TransactionClient, billId: string) {
  const items = await tx.supplierBillItem.findMany({ where: { supplierBillId: billId }, select: { quantity: true, unitPrice: true, total: true } });
  let subtotal = ZERO, total = ZERO;
  for (const item of items) {
    const qty = toMoney(item.quantity);
    const price = toMoney(item.unitPrice);
    const lineTotal = roundMoney(qty.times(price));
    subtotal = subtotal.plus(lineTotal);
    total = total.plus(lineTotal);
  }
  return { subtotal: serializeMoney(subtotal), tax: "0", total: serializeMoney(total) };
}

export async function recomputeBillBalance(tx: TransactionClient, billId: string) {
  const [bill, payments] = await Promise.all([
    tx.supplierBill.findUnique({ where: { id: billId }, select: { total: true } }),
    tx.supplierPayment.findMany({ where: { supplierBillId: billId, status: "posted" }, select: { amount: true } }),
  ]);
  if (!bill) return null;
  const total = toMoney(bill.total);
  let paid = ZERO;
  for (const p of payments) paid = paid.plus(toMoney(p.amount));
  const balance = total.minus(paid).lt(0) ? ZERO : total.minus(paid);
  return {
    amountPaid: serializeMoney(paid),
    balanceDue: serializeMoney(balance),
    total: serializeMoney(total),
  };
}

/** Determine if a bill is overdue (derived, not stored). */
export function isBillOverdue(bill: { dueDate: Date | null; balanceDue: any; status: string }): boolean {
  if (bill.status === "voided" || bill.status === "paid") return false;
  if (!bill.dueDate) return false;
  const balance = toMoney(bill.balanceDue);
  if (balance.lte(0)) return false;
  return new Date(bill.dueDate) < new Date();
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
