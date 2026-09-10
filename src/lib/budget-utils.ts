// ============================================================================
// LBMS Phase 12 — Budgeting, Forecasting & Variance Analysis Helpers
// ----------------------------------------------------------------------------
// Budget = management planning record. NEVER creates Journal/JournalEntry.
// Actuals always come from authoritative Finance ledger (getFinanceSummary).
// ============================================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { toMoney, roundMoney, serializeMoney, ZERO, type Money } from "@/lib/finance/money";

type TransactionClient = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// Reference number generation
// ---------------------------------------------------------------------------

export async function nextBudgetRefNumber(
  tx: TransactionClient,
  year: number,
): Promise<string> {
  const counter = await tx.budgetRefCounter.upsert({
    where: { prefix_year: { prefix: "BUD", year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix: "BUD", year, nextNumber: 1 },
  });
  return `BUD-${year}-${String(counter.nextNumber).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const BUDGET_STATUSES = ["draft", "submitted", "approved", "locked", "cancelled"] as const;

export const BUDGET_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "cancelled"],
  approved: ["locked", "cancelled"],
  locked: [],
  cancelled: [],
};

export function isValidBudgetTransition(from: string, to: string): boolean {
  return (BUDGET_TRANSITIONS[from] ?? []).includes(to);
}

export const BUDGET_EDITABLE = new Set(["draft"]);
export const BUDGET_TERMINAL = new Set(["locked", "cancelled"]);

// ---------------------------------------------------------------------------
// Budget totals recompute
// ---------------------------------------------------------------------------

export async function recomputeBudgetTotal(tx: TransactionClient, budgetId: string): Promise<string> {
  const lines = await tx.budgetLine.findMany({ where: { budgetId }, select: { amount: true } });
  let total = ZERO;
  for (const l of lines) total = total.plus(toMoney(l.amount));
  return serializeMoney(total);
}

// ---------------------------------------------------------------------------
// Variance calculation
// ---------------------------------------------------------------------------

export interface VarianceResult {
  budgetAmount: string;
  actualAmount: string;
  variance: string;
  variancePct: string;
  classification: "favorable" | "unfavorable" | "neutral";
}

/**
 * Calculate variance = Actual − Budget.
 * Classification is account-aware:
 *   - income (revenue): Actual > Budget → Favorable
 *   - expense: Actual > Budget → Unfavorable
 *   - zero variance → Neutral
 */
export function calculateVariance(budget: Money, actual: Money, accountClass: string): VarianceResult {
  const variance = actual.minus(budget);
  const absVariance = roundMoney(variance);
  let classification: "favorable" | "unfavorable" | "neutral" = "neutral";

  if (absVariance.gt(0)) {
    // Actual > Budget
    classification = accountClass === "income" ? "favorable" : "unfavorable";
  } else if (absVariance.lt(0)) {
    // Actual < Budget
    classification = accountClass === "income" ? "unfavorable" : "favorable";
  }

  const variancePct = budget.gt(0)
    ? serializeMoney(absVariance.div(budget).times(100))
    : "0";

  return {
    budgetAmount: serializeMoney(budget),
    actualAmount: serializeMoney(actual),
    variance: serializeMoney(absVariance),
    variancePct,
    classification,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateBudgetAmount(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount: "${value}"`);
  const d = toMoney(s);
  if (d.lt(0)) throw new Error(`Budget amount cannot be negative (received ${s}).`);
  if (d.gt(1_000_000_000_000)) throw new Error(`Budget amount exceeds maximum (received ${s}).`);
  return serializeMoney(d);
}

export function validateMonth(value: unknown): number {
  const m = Number(value);
  if (isNaN(m) || m < 1 || m > 12) throw new Error(`Month must be 1-12 (received ${value}).`);
  return m;
}
