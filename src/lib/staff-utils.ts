// ============================================================================
// LBMS Staff & HR Helpers
// ----------------------------------------------------------------------------
// Shared utilities for Phase 3 staff APIs: circular manager-chain detection,
// reference number generation via EmployeeRefCounter, and notification helpers.
// Kept here (rather than in api-helpers.ts) because they are HR-specific.
// ============================================================================

import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Walk the manager chain starting from `proposedManagerId` upwards. Returns
 * true if assigning `proposedManagerId` to `employeeId` would create a
 * circular reporting line (i.e. `employeeId` is reachable from
 * `proposedManagerId` via manager links, or the two are the same person).
 *
 * Capped at 100 hops to defend against pathological pre-existing cycles.
 */
export async function wouldCreateCircularManager(
  employeeId: string,
  proposedManagerId: string | null | undefined,
): Promise<boolean> {
  if (!proposedManagerId) return false;
  if (proposedManagerId === employeeId) return true; // self-reference

  let current: string | null = proposedManagerId;
  let depth = 0;
  while (current && depth < 100) {
    if (current === employeeId) return true;
    const mgr = await db.employee.findUnique({
      where: { id: current },
      select: { managerId: true, deletedAt: true },
    });
    if (!mgr || mgr.deletedAt) return false; // manager gone — caller should validate separately
    current = mgr.managerId;
    depth++;
  }
  return false;
}

/**
 * Same as `wouldCreateCircularManager` but uses a transaction client so it
 * can be evaluated inside a `db.$transaction` block before the write.
 */
export async function wouldCreateCircularManagerTx(
  tx: PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  employeeId: string,
  proposedManagerId: string | null | undefined,
): Promise<boolean> {
  if (!proposedManagerId) return false;
  if (proposedManagerId === employeeId) return true;

  let current: string | null = proposedManagerId;
  let depth = 0;
  while (current && depth < 100) {
    if (current === employeeId) return true;
    const mgr = await tx.employee.findUnique({
      where: { id: current },
      select: { managerId: true },
    });
    if (!mgr) return false;
    current = mgr.managerId;
    depth++;
  }
  return false;
}

/**
 * Atomically claim + return the next EMP-YYYY-NNNNNN employee number.
 * Must be called inside a `db.$transaction`. The first sequence issued is
 * `000001` (created row uses nextNumber=1, then we increment-then-read so
 * the value returned is the next available number).
 */
export async function nextEmployeeNumber(
  tx: PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  year: number,
  prefix = "EMP",
): Promise<string> {
  const counter = await tx.employeeRefCounter.upsert({
    where: { prefix_year: { prefix, year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix, year, nextNumber: 1 },
  });
  return `${prefix}-${year}-${String(counter.nextNumber).padStart(6, "0")}`;
}

/**
 * Same as `nextEmployeeNumber` but with a configurable prefix (used for
 * LEV-YYYY-NNNNNN leave references).
 */
export async function nextReferenceNumber(
  tx: PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  prefix: string,
  year: number,
): Promise<string> {
  const counter = await tx.employeeRefCounter.upsert({
    where: { prefix_year: { prefix, year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix, year, nextNumber: 1 },
  });
  return `${prefix}-${year}-${String(counter.nextNumber).padStart(6, "0")}`;
}

/**
 * Send a notification to the user attached to an employee (if any).
 * Used by the leave approval/rejection flow to inform the requester.
 */
export async function notifyEmployeeUser(opts: {
  employeeId: string;
  title: string;
  message: string;
  type?: "info" | "success" | "warning" | "error";
  category?: string;
  linkUrl?: string;
}): Promise<void> {
  const emp = await db.employee.findUnique({
    where: { id: opts.employeeId },
    select: { user: { select: { id: true } } },
  });
  if (!emp?.user) return; // employee has no user account — nothing to do
  await db.notification.create({
    data: {
      userId: emp.user.id,
      title: opts.title,
      message: opts.message,
      type: opts.type ?? "info",
      category: opts.category ?? null,
      linkUrl: opts.linkUrl ?? null,
    },
  });
}

/**
 * Send a notification to a specific user ID (used to notify a manager of a
 * new leave request awaiting their approval).
 */
export async function notifyUser(opts: {
  userId: string;
  title: string;
  message: string;
  type?: "info" | "success" | "warning" | "error";
  category?: string;
  linkUrl?: string;
}): Promise<void> {
  await db.notification.create({
    data: {
      userId: opts.userId,
      title: opts.title,
      message: opts.message,
      type: opts.type ?? "info",
      category: opts.category ?? null,
      linkUrl: opts.linkUrl ?? null,
    },
  });
}
