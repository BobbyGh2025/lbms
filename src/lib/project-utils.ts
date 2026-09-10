// ============================================================================
// LBMS Phase 5 — Project Management Helpers
// ----------------------------------------------------------------------------
// Shared utilities for Phase 5 Project API routes:
//   • `nextProjectNumber`     — concurrency-safe PRJ-YYYY-NNNNNN generation
//                                via the ProjectRefCounter table.
//   • `getProjectFinanceSummary` — authoritative finance roll-up for a
//                                project, derived from posted Journal rows
//                                linked to the project via the `projectId`
//                                FK. Never reads the denormalised
//                                `estimatedRevenue`/`estimatedCost` fields
//                                on Project — those are estimates only.
//
// Money flows as Prisma.Decimal on the server and is serialised to STRING
// on the wire via `serializeMoney()`. See `src/lib/finance/money.ts`.
// ============================================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  toMoney,
  addMoney,
  subMoney,
  serializeMoney,
  ZERO,
  type Money,
} from "@/lib/finance/money";

/** Transaction client type accepted by the helpers below. */
type TransactionClient =
  | PrismaClient
  | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// Project number generation
// ---------------------------------------------------------------------------

/**
 * Atomically claim + return the next project reference number for the given
 * year. Must be called inside a `db.$transaction`. Produces numbers in the
 * form `PRJ-<YYYY>-<NNNNNN>` where NNNNNN is zero-padded to 6 digits.
 *
 * Example: `nextProjectNumber(tx, 2026)` → "PRJ-2026-000001"
 *
 * Uses upsert + increment so the very first call seeds the counter at 1
 * and every subsequent call atomically increments it — safe under
 * concurrent transactions. The ProjectRefCounter is a SEPARATE counter
 * from RelationshipRefCounter (customers/suppliers) and EmployeeRefCounter
 * so project numbering can never collide with other entities.
 */
export async function nextProjectNumber(
  tx: TransactionClient,
  year: number,
): Promise<string> {
  const counter = await tx.projectRefCounter.upsert({
    where: { prefix_year: { prefix: "PRJ", year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix: "PRJ", year, nextNumber: 1 },
  });
  return `PRJ-${year}-${String(counter.nextNumber).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Project finance summary — derived from authoritative Finance ledger
// ---------------------------------------------------------------------------

export interface ProjectFinanceSummary {
  projectId: string;
  /** Σ of posted income journals linked to the project (string money). */
  totalRevenue: string;
  /** Σ of posted expense journals linked to the project (string money). */
  totalCost: string;
  /** totalRevenue − totalCost (string money). May be negative. */
  actualProfit: string;
  /** Posted income journal count (for UI badges). */
  incomeEntryCount: number;
  /** Posted expense journal count (for UI badges). */
  expenseEntryCount: number;
}

/**
 * Compute the authoritative finance roll-up for a single project.
 *
 * Aggregates posted `income` and `expense` journals linked via the
 * `projectId` FK. Draft / voided / reversed journals are excluded so
 * the figures reflect realised money only. All money is summed as
 * Prisma.Decimal (decimal.js) — never as JS Number — and serialised to
 * string for safe JSON transport.
 *
 * Returns zeroes (not null) when the project has no posted journals.
 */
export async function getProjectFinanceSummary(
  projectId: string,
): Promise<ProjectFinanceSummary> {
  const baseWhere = {
    projectId,
    status: "posted" as const,
  };

  const [incomeAgg, expenseAgg, incomeCount, expenseCount] = await Promise.all([
    db.journal.aggregate({
      _sum: { amount: true },
      where: { ...baseWhere, transactionType: "income" },
    }),
    db.journal.aggregate({
      _sum: { amount: true },
      where: { ...baseWhere, transactionType: "expense" },
    }),
    db.journal.count({
      where: { ...baseWhere, transactionType: "income" },
    }),
    db.journal.count({
      where: { ...baseWhere, transactionType: "expense" },
    }),
  ]);

  const revenue: Money = addMoney(
    toMoney(incomeAgg._sum.amount ?? ZERO),
    ZERO,
  );
  const cost: Money = addMoney(
    toMoney(expenseAgg._sum.amount ?? ZERO),
    ZERO,
  );
  const profit: Money = subMoney(revenue, cost);

  return {
    projectId,
    totalRevenue: serializeMoney(revenue),
    totalCost: serializeMoney(cost),
    actualProfit: serializeMoney(profit),
    incomeEntryCount: incomeCount,
    expenseEntryCount: expenseCount,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle transition map — used by /api/projects/[id]/status
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = [
  "planning",
  "active",
  "on_hold",
  "completed",
  "cancelled",
] as const;

export const PROJECT_PRIORITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

/**
 * Valid lifecycle transitions. Source status → set of allowed target
 * statuses. Any transition NOT listed here is rejected by the status
 * endpoint with a 400.
 *
 * Spec:
 *   planning → active, planning → cancelled
 *   active   → on_hold, active → completed, active → cancelled
 *   on_hold  → active
 *   completed / cancelled are terminal (no outbound edges).
 */
export const PROJECT_TRANSITIONS: Record<string, readonly string[]> = {
  planning: ["active", "cancelled"],
  active: ["on_hold", "completed", "cancelled"],
  on_hold: ["active"],
  completed: [],
  cancelled: [],
};

export function isValidTransition(from: string, to: string): boolean {
  const allowed = PROJECT_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}
