// ============================================================================
// LBMS CRM Relationship Helpers
// ----------------------------------------------------------------------------
// Shared utilities for Phase 4 CRM APIs: concurrency-safe reference number
// generation for customer/supplier numbers via the RelationshipRefCounter
// table. Kept here (rather than in api-helpers.ts) because it is CRM-specific.
// ============================================================================

import { PrismaClient } from "@prisma/client";

type TransactionClient =
  | PrismaClient
  | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Atomically claim + return the next reference number for a CRM party.
 * Must be called inside a `db.$transaction`. Produces numbers in the form
 * `<PREFIX>-<YYYY>-<NNNNNN>` where NNNNNN is zero-padded to 6 digits.
 *
 * Examples:
 *   nextRelationshipNumber(tx, "CUS", 2026) → "CUS-2026-000001"
 *   nextRelationshipNumber(tx, "SUP", 2026) → "SUP-2026-000001"
 *
 * Uses upsert + increment so the very first call seeds the counter at 1
 * and every subsequent call atomically increments it — safe under
 * concurrent transactions.
 */
export async function nextRelationshipNumber(
  tx: TransactionClient,
  prefix: string,
  year: number,
): Promise<string> {
  const counter = await tx.relationshipRefCounter.upsert({
    where: { prefix_year: { prefix, year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix, year, nextNumber: 1 },
  });
  return `${prefix}-${year}-${String(counter.nextNumber).padStart(6, "0")}`;
}

/**
 * Convenience helper for customer numbers (prefix "CUS"). Equivalent to
 * `nextRelationshipNumber(tx, "CUS", year)`.
 */
export function nextCustomerNumber(
  tx: TransactionClient,
  year: number,
): Promise<string> {
  return nextRelationshipNumber(tx, "CUS", year);
}

/**
 * Convenience helper for supplier numbers (prefix "SUP"). Equivalent to
 * `nextRelationshipNumber(tx, "SUP", year)`.
 */
export function nextSupplierNumber(
  tx: TransactionClient,
  year: number,
): Promise<string> {
  return nextRelationshipNumber(tx, "SUP", year);
}
