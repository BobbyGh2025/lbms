// ============================================================================
// LBMS Phase 6 — Operations & Workflow Task Helpers
// ----------------------------------------------------------------------------
// Shared utilities for Phase 6 Task API routes:
//   • `nextTaskNumber`        — concurrency-safe TSK-YYYY-NNNNNN generation
//                                via the dedicated TaskRefCounter table.
//   • `TASK_STATUSES`         — canonical task status enum.
//   • `TASK_PRIORITIES`       — canonical task priority enum.
//   • `TASK_TRANSITIONS`      — lifecycle transition graph.
//   • `isValidTaskTransition` — guard used by /api/tasks/[id]/status.
//
// The TaskRefCounter is a SEPARATE counter from ProjectRefCounter,
// RelationshipRefCounter (customers/suppliers) and EmployeeRefCounter —
// task numbering can never collide with other entities.
//
// Tasks are NOT accounting entries. They track operational work execution,
// deadlines and assignments. Financial integration happens via the
// Finance posting engine (which can link a Journal row to a task's
// related project/customer if needed).
// ============================================================================

import { PrismaClient, Prisma } from "@prisma/client";

/** Transaction client type accepted by the helpers below. */
type TransactionClient =
  | PrismaClient
  | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// Task number generation
// ---------------------------------------------------------------------------

/**
 * Atomically claim + return the next task reference number for the given
 * year. Must be called inside a `db.$transaction`. Produces numbers in the
 * form `TSK-<YYYY>-<NNNNNN>` where NNNNNN is zero-padded to 6 digits.
 *
 * Example: `nextTaskNumber(tx, 2026)` → "TSK-2026-000001"
 *
 * Uses upsert + increment so the very first call seeds the counter at 1
 * and every subsequent call atomically increments it — safe under
 * concurrent transactions (modulo SQLite's single-writer limitation).
 */
export async function nextTaskNumber(
  tx: TransactionClient,
  year: number,
): Promise<string> {
  const counter = await tx.taskRefCounter.upsert({
    where: { prefix_year: { prefix: "TSK", year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix: "TSK", year, nextNumber: 1 },
  });
  return `TSK-${year}-${String(counter.nextNumber).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Canonical task status / priority enums
// ---------------------------------------------------------------------------

export const TASK_STATUSES = [
  "todo",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
] as const;

export const TASK_PRIORITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

// ---------------------------------------------------------------------------
// Lifecycle transition map — used by /api/tasks/[id]/status
// ---------------------------------------------------------------------------

/**
 * Valid lifecycle transitions. Source status → set of allowed target
 * statuses. Any transition NOT listed here is rejected by the status
 * endpoint with a 400.
 *
 * Spec:
 *   todo        → in_progress | cancelled
 *   in_progress → on_hold | completed | cancelled
 *   on_hold     → in_progress
 *   completed   /  cancelled are terminal (no outbound edges).
 *
 * Side-effects handled by the status endpoint (NOT here):
 *   • status → in_progress sets startDate = now (if not already set).
 *   • status → completed  sets completedDate = now.
 */
export const TASK_TRANSITIONS: Record<string, readonly string[]> = {
  todo: ["in_progress", "cancelled"],
  in_progress: ["on_hold", "completed", "cancelled"],
  on_hold: ["in_progress"],
  completed: [],
  cancelled: [],
};

/** Human-readable copy of TASK_TRANSITIONS for error-message rendering. */
export const TASK_TRANSITIONS_LIST: Record<string, string[]> = {
  todo: ["in_progress", "cancelled"],
  in_progress: ["on_hold", "completed", "cancelled"],
  on_hold: ["in_progress"],
  completed: [],
  cancelled: [],
};

export function isValidTaskTransition(from: string, to: string): boolean {
  const allowed = TASK_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

/** Terminal task states — PATCH (general edit) is blocked. */
export const TASK_TERMINAL_STATUSES = new Set<string>(["completed", "cancelled"]);
