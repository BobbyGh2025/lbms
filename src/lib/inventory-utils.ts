// ============================================================================
// LBMS Phase 8 — Inventory & Warehouse Management Helpers
// ----------------------------------------------------------------------------
// Centralized inventory logic. ALL stock mutations MUST go through these
// functions to guarantee the stock-balance invariant:
//
//   Current Stock = Σ(in movements) − Σ(out movements)
//
// Every mutation:
//   1. runs inside a db.$transaction
//   2. creates an append-only StockMovement ledger row
//   3. updates the cached StockBalance row atomically
//   4. rejects negative stock (decrease blocked if insufficient)
//
// FINANCE BOUNDARY: These helpers NEVER touch Journal/JournalEntry. Inventory
// is operational; finance valuation is deferred.
//
// DOUBLE-POSTING PREVENTION: Receipt movements use referenceType=
// "goods_receipt_item" + the @@unique([referenceType, referenceId]) constraint
// on StockMovement. A second posting of the same GoodsReceiptItem is rejected
// by the DB constraint.
// ============================================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { toMoney, roundMoney, serializeMoney, ZERO, type Money } from "@/lib/finance/money";

/** Transaction client type accepted by the helpers below. */
type TransactionClient =
  | PrismaClient
  | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// Inventory reference number generation
// ---------------------------------------------------------------------------

/** Atomically claim + return the next inventory reference number.
 *  Prefixes: SRI (stock receipt), ISS (issue), TRF (transfer), ADJ (adjustment).
 *  Format: <PREFIX>-<YYYY>-<NNNNNN> e.g. "SRI-2026-000001"
 */
export async function nextInventoryRefNumber(
  tx: TransactionClient,
  prefix: string,
  year: number,
): Promise<string> {
  const counter = await tx.inventoryRefCounter.upsert({
    where: { prefix_year: { prefix, year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix, year, nextNumber: 1 },
  });
  return `${prefix}-${year}-${String(counter.nextNumber).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Canonical movement types + directions
// ---------------------------------------------------------------------------

export const MOVEMENT_TYPES = [
  "RECEIPT",
  "ISSUE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
] as const;

/** Movement types that INCREASE stock at the warehouse. */
const IN_MOVEMENTS = new Set(["RECEIPT", "TRANSFER_IN", "ADJUSTMENT_IN"]);
/** Movement types that DECREASE stock at the warehouse. */
const OUT_MOVEMENTS = new Set(["ISSUE", "TRANSFER_OUT", "ADJUSTMENT_OUT"]);

export function isMovementType(v: unknown): v is (typeof MOVEMENT_TYPES)[number] {
  return typeof v === "string" && (MOVEMENT_TYPES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Stock balance helpers
// ---------------------------------------------------------------------------

/**
 * Get the current on-hand quantity for an item at a warehouse. Returns the
 * cached StockBalance.quantity (which is kept consistent with the movement
 * ledger). Returns 0 if no balance row exists.
 */
export async function getStockQuantity(
  tx: TransactionClient,
  inventoryItemId: string,
  warehouseId: string,
): Promise<Money> {
  const balance = await tx.stockBalance.findUnique({
    where: { inventoryItemId_warehouseId: { inventoryItemId, warehouseId } },
    select: { quantity: true },
  });
  return balance ? toMoney(balance.quantity) : ZERO;
}

/**
 * Derive the authoritative stock quantity from the movement ledger. Used for
 * integrity verification (balance cache vs ledger). This is the source of
 * truth — the cached StockBalance must always equal this.
 */
export async function getLedgerQuantity(
  tx: TransactionClient,
  inventoryItemId: string,
  warehouseId: string,
): Promise<Money> {
  const movements = await tx.stockMovement.findMany({
    where: { inventoryItemId, warehouseId },
    select: { movementType: true, quantity: true },
  });
  let total: Money = ZERO;
  for (const m of movements) {
    const qty = toMoney(m.quantity);
    if (IN_MOVEMENTS.has(m.movementType)) {
      total = total.plus(qty);
    } else if (OUT_MOVEMENTS.has(m.movementType)) {
      total = total.minus(qty);
    }
  }
  return roundMoney(total);
}

// ---------------------------------------------------------------------------
// Core mutation primitives — increase / decrease (internal, not exported)
// ---------------------------------------------------------------------------

/** Increase stock at a warehouse by the given quantity. Creates the balance
 *  row if it doesn't exist (upsert). Does NOT create the movement — the caller
 *  is responsible for recording the movement. */
async function increaseBalance(
  tx: TransactionClient,
  inventoryItemId: string,
  warehouseId: string,
  amount: Money,
): Promise<void> {
  await tx.stockBalance.upsert({
    where: { inventoryItemId_warehouseId: { inventoryItemId, warehouseId } },
    update: { quantity: { increment: serializeMoney(amount) } },
    create: { inventoryItemId, warehouseId, quantity: serializeMoney(amount) },
  });
}

/** Decrease stock at a warehouse by the given quantity. Rejects if the
 *  resulting balance would be negative. Does NOT create the movement. */
async function decreaseBalance(
  tx: TransactionClient,
  inventoryItemId: string,
  warehouseId: string,
  amount: Money,
): Promise<void> {
  const current = await getStockQuantity(tx, inventoryItemId, warehouseId);
  const newQty = current.minus(amount);
  if (newQty.lt(0)) {
    throw new InsufficientStockError(inventoryItemId, warehouseId, current, amount);
  }
  await tx.stockBalance.update({
    where: { inventoryItemId_warehouseId: { inventoryItemId, warehouseId } },
    data: { quantity: serializeMoney(newQty) },
  });
}

/** Verify a balance row exists and has sufficient stock for a decrease. */
export async function hasSufficientStock(
  tx: TransactionClient,
  inventoryItemId: string,
  warehouseId: string,
  required: Money,
): Promise<boolean> {
  const current = await getStockQuantity(tx, inventoryItemId, warehouseId);
  return current.gte(required);
}

// ---------------------------------------------------------------------------
// Public stock operations
// ---------------------------------------------------------------------------

/** Custom error raised when an operation would make stock negative. */
export class InsufficientStockError extends Error {
  statusCode = 400;
  constructor(
    public inventoryItemId: string,
    public warehouseId: string,
    public currentStock: Money,
    public requested: Money,
  ) {
    super(
      `Insufficient stock: item ${inventoryItemId} at warehouse ${warehouseId} has ${serializeMoney(currentStock)} on hand; cannot move ${serializeMoney(requested)}.`,
    );
    this.name = "InsufficientStockError";
  }
}

export interface MovementContext {
  performedById: string;
  reason?: string;
  notes?: string;
  projectId?: string;
  taskId?: string;
  supplierId?: string;
  employeeId?: string;
}

/**
 * Record a stock receipt from a GoodsReceiptItem into a warehouse. Creates a
 * RECEIPT movement + increases the balance. The referenceType=
 * "goods_receipt_item" + referenceId = the GoodsReceiptItem ID, enforced
 * unique by the DB constraint — a second call for the same receipt item is
 * rejected (double-posting prevention).
 *
 * @returns the created StockMovement.
 */
export async function receiveStockFromGoodsReceipt(
  tx: TransactionClient,
  params: {
    goodsReceiptItemId: string;
    inventoryItemId: string;
    warehouseId: string;
    quantity: Money;
    movementNumber: string;
    ctx: MovementContext;
    notes?: string;
  },
): Promise<{ movement: any; balanceBefore: Money; balanceAfter: Money }> {
  const { goodsReceiptItemId, inventoryItemId, warehouseId, quantity, movementNumber, ctx, notes } = params;
  const balanceBefore = await getStockQuantity(tx, inventoryItemId, warehouseId);

  // Create the RECEIPT movement first (the unique constraint on
  // [referenceType, referenceId] prevents a second posting of the same
  // goods receipt item).
  const movement = await tx.stockMovement.create({
    data: {
      movementNumber,
      inventoryItemId,
      warehouseId,
      quantity: serializeMoney(quantity),
      movementType: "RECEIPT",
      referenceType: "goods_receipt_item",
      referenceId: goodsReceiptItemId,
      reason: ctx.reason ?? null,
      notes: notes ?? null,
      supplierId: ctx.supplierId ?? null,
      performedById: ctx.performedById,
      projectId: ctx.projectId ?? null,
      taskId: ctx.taskId ?? null,
      employeeId: ctx.employeeId ?? null,
    },
  });

  await increaseBalance(tx, inventoryItemId, warehouseId, quantity);
  const balanceAfter = balanceBefore.plus(quantity);

  return { movement, balanceBefore, balanceAfter };
}

/**
 * Issue stock out of a warehouse (to a project/task/employee). Creates an
 * ISSUE movement + decreases the balance. Rejects if insufficient stock.
 */
export async function issueStock(
  tx: TransactionClient,
  params: {
    inventoryItemId: string;
    warehouseId: string;
    quantity: Money;
    movementNumber: string;
    ctx: MovementContext;
  },
): Promise<{ movement: any; balanceBefore: Money; balanceAfter: Money }> {
  const { inventoryItemId, warehouseId, quantity, movementNumber, ctx } = params;
  const balanceBefore = await getStockQuantity(tx, inventoryItemId, warehouseId);
  if (balanceBefore.lt(quantity)) {
    throw new InsufficientStockError(inventoryItemId, warehouseId, balanceBefore, quantity);
  }

  await decreaseBalance(tx, inventoryItemId, warehouseId, quantity);

  const movement = await tx.stockMovement.create({
    data: {
      movementNumber,
      inventoryItemId,
      warehouseId,
      quantity: serializeMoney(quantity),
      movementType: "ISSUE",
      referenceType: "issue",
      referenceId: movementNumber,
      reason: ctx.reason ?? null,
      notes: ctx.notes ?? null,
      projectId: ctx.projectId ?? null,
      taskId: ctx.taskId ?? null,
      employeeId: ctx.employeeId ?? null,
      performedById: ctx.performedById,
    },
  });

  return { movement, balanceBefore, balanceAfter: balanceBefore.minus(quantity) };
}

/**
 * Transfer stock from one warehouse to another. Atomic — creates a paired
 * TRANSFER_OUT + TRANSFER_IN movement sharing the same referenceId (the
 * transfer group). If either decrease or increase fails, the whole transaction
 * rolls back. Rejects if source has insufficient stock or if source==dest.
 */
export async function transferStock(
  tx: TransactionClient,
  params: {
    inventoryItemId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    quantity: Money;
    transferNumber: string; // used as the shared referenceId
    ctx: MovementContext;
  },
): Promise<{ outMovement: any; inMovement: any; sourceBalanceBefore: Money; destBalanceBefore: Money }> {
  const { inventoryItemId, fromWarehouseId, toWarehouseId, quantity, transferNumber, ctx } = params;

  if (fromWarehouseId === toWarehouseId) {
    throw new Error("Source and destination warehouses must differ for a transfer.");
  }

  const sourceBalanceBefore = await getStockQuantity(tx, inventoryItemId, fromWarehouseId);
  if (sourceBalanceBefore.lt(quantity)) {
    throw new InsufficientStockError(inventoryItemId, fromWarehouseId, sourceBalanceBefore, quantity);
  }
  const destBalanceBefore = await getStockQuantity(tx, inventoryItemId, toWarehouseId);

  // Decrease source first
  await decreaseBalance(tx, inventoryItemId, fromWarehouseId, quantity);

  // Create TRANSFER_OUT movement (referenceId distinguishes OUT vs IN to
  // satisfy the @@unique([referenceType, referenceId]) constraint)
  const outMovement = await tx.stockMovement.create({
    data: {
      movementNumber: `${transferNumber}-OUT`,
      inventoryItemId,
      warehouseId: fromWarehouseId,
      counterpartWarehouseId: toWarehouseId,
      quantity: serializeMoney(quantity),
      movementType: "TRANSFER_OUT",
      referenceType: "transfer_out",
      referenceId: transferNumber,
      reason: ctx.reason ?? null,
      notes: ctx.notes ?? null,
      performedById: ctx.performedById,
      projectId: ctx.projectId ?? null,
      taskId: ctx.taskId ?? null,
    },
  });

  // Increase destination
  await increaseBalance(tx, inventoryItemId, toWarehouseId, quantity);

  // Create TRANSFER_IN movement (distinct referenceType so it doesn't collide
  // with the TRANSFER_OUT row on the unique constraint)
  const inMovement = await tx.stockMovement.create({
    data: {
      movementNumber: `${transferNumber}-IN`,
      inventoryItemId,
      warehouseId: toWarehouseId,
      counterpartWarehouseId: fromWarehouseId,
      quantity: serializeMoney(quantity),
      movementType: "TRANSFER_IN",
      referenceType: "transfer_in",
      referenceId: transferNumber,
      reason: ctx.reason ?? null,
      notes: ctx.notes ?? null,
      performedById: ctx.performedById,
      projectId: ctx.projectId ?? null,
      taskId: ctx.taskId ?? null,
    },
  });

  return { outMovement, inMovement, sourceBalanceBefore, destBalanceBefore };
}

/**
 * Adjust stock at a warehouse (positive or negative). Creates an
 * ADJUSTMENT_IN or ADJUSTMENT_OUT movement depending on the direction. The
 * caller passes the DELTA (not the new balance) — the system records the
 * actual change, never a bare "set to X". Negative adjustments that would make
 * stock negative are rejected.
 */
export async function adjustStock(
  tx: TransactionClient,
  params: {
    inventoryItemId: string;
    warehouseId: string;
    delta: Money; // positive = increase, negative = decrease
    adjustmentNumber: string;
    ctx: MovementContext;
  },
): Promise<{ movement: any; balanceBefore: Money; balanceAfter: Money }> {
  const { inventoryItemId, warehouseId, delta, adjustmentNumber, ctx } = params;
  const balanceBefore = await getStockQuantity(tx, inventoryItemId, warehouseId);

  const isIncrease = delta.gte(0);
  const absQty = isIncrease ? delta : delta.abs();
  const movementType = isIncrease ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";

  if (!isIncrease) {
    if (balanceBefore.lt(absQty)) {
      throw new InsufficientStockError(inventoryItemId, warehouseId, balanceBefore, absQty);
    }
    await decreaseBalance(tx, inventoryItemId, warehouseId, absQty);
  } else {
    await increaseBalance(tx, inventoryItemId, warehouseId, absQty);
  }

  const movement = await tx.stockMovement.create({
    data: {
      movementNumber: adjustmentNumber,
      inventoryItemId,
      warehouseId,
      quantity: serializeMoney(absQty),
      movementType,
      referenceType: "adjustment",
      referenceId: adjustmentNumber,
      reason: ctx.reason ?? null,
      notes: ctx.notes ?? null,
      performedById: ctx.performedById,
      projectId: ctx.projectId ?? null,
      taskId: ctx.taskId ?? null,
      employeeId: ctx.employeeId ?? null,
    },
  });

  const balanceAfter = isIncrease ? balanceBefore.plus(absQty) : balanceBefore.minus(absQty);
  return { movement, balanceBefore, balanceAfter };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Reject negative, zero, non-numeric, or excessively large quantities. */
export function validateQuantity(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid quantity: "${value}"`);
  }
  const d = toMoney(s);
  if (d.lte(0)) {
    throw new Error(`Quantity must be greater than zero (received ${s}).`);
  }
  if (d.gt(1_000_000_000)) {
    throw new Error(`Quantity exceeds maximum allowed value of 1,000,000,000 (received ${s}).`);
  }
  return serializeMoney(d);
}

/** Validate a reorder level (>= 0, no upper bound beyond the generic limit). */
export function validateReorderLevel(value: unknown): string {
  const s = String(value ?? "0").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid reorder level: "${value}"`);
  }
  const d = toMoney(s);
  if (d.lt(0)) {
    throw new Error(`Reorder level cannot be negative (received ${s}).`);
  }
  return serializeMoney(d);
}
