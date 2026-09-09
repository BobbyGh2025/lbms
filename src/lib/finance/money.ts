// ============================================================================
// LBMS Finance — Money & Decimal Helpers
// ----------------------------------------------------------------------------
// Centralized handling of monetary values. Money flows as `Prisma.Decimal`
// (powered by decimal.js) on the server and is serialized to STRING on the
// wire to avoid JavaScript floating-point corruption. The client uses the
// formatting helpers here for display only — never for calculation.
// ============================================================================

import { Prisma } from "@prisma/client";

export type Money = Prisma.Decimal;

/** Parse a value into a Prisma.Decimal, rejecting invalid/NaN. */
export function toMoney(value: string | number | Money | null | undefined): Money {
  if (value === null || value === undefined || value === "") {
    return new Prisma.Decimal(0);
  }
  if (value instanceof Prisma.Decimal) return value;
  const s = typeof value === "number" ? String(value) : String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new MoneyError(`Invalid monetary value: "${value}"`);
  }
  const d = new Prisma.Decimal(s);
  if (d.isNaN()) throw new MoneyError(`Invalid monetary value: "${value}"`);
  return d;
}

/** Require a strictly positive amount (> 0). */
export function toPositiveMoney(value: string | number | Money | null | undefined): Money {
  const d = toMoney(value);
  if (d.lte(0)) {
    throw new MoneyError(`Amount must be greater than zero (received ${d.toString()}).`);
  }
  // Round to 2 decimal places (cents). Throws if more than 2 dp supplied? No — round.
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Round to 2 decimal places (cents). */
export function roundMoney(value: Money | string | number): Money {
  return toMoney(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Add two money values. */
export function addMoney(a: Money, b: Money): Money {
  return toMoney(a).plus(toMoney(b));
}

/** Subtract two money values. */
export function subMoney(a: Money, b: Money): Money {
  return toMoney(a).minus(toMoney(b));
}

/** Zero sentinel. */
export const ZERO = new Prisma.Decimal(0);

/** Compare equality (exact). */
export function moneyEq(a: Money | string | number, b: Money | string | number): boolean {
  return toMoney(a).equals(toMoney(b));
}

/** Is the value zero? */
export function isZero(value: Money | string | number): boolean {
  return toMoney(value).isZero();
}

/**
 * Serialize a Decimal for JSON transport. Always returns a string so the
 * client receives exact precision (e.g. "5000.00", never 5000.000000000001).
 */
export function serializeMoney(value: Money | string | number | null | undefined): string {
  if (value === null || value === undefined) return "0.00";
  return roundMoney(value).toString();
}

/**
 * Format money for human display: "GHS 5,000.00".
 * Uses Intl.NumberFormat for grouping but keeps the currency code prefix
 * for clarity (spec §58: "GHS 5,000.00" is the canonical form).
 */
export function formatMoney(value: Money | string | number | null | undefined, currency = "GHS"): string {
  const d = roundMoney(value ?? 0);
  const num = Number(d.toString());
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `${currency} ${formatted}`;
}

/** Format money without the currency code (e.g. "5,000.00"). */
export function formatAmount(value: Money | string | number | null | undefined): string {
  const d = roundMoney(value ?? 0);
  const num = Number(d.toString());
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/** Custom error class for monetary validation failures. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}
