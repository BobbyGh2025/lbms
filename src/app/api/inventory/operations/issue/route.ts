// ============================================================================
// LBMS Phase 8 API — Stock Issue
// ----------------------------------------------------------------------------
// POST /api/inventory/operations/issue
//   Issue stock out of a warehouse (to a project/task/employee). Creates an
//   ISSUE movement + decreases the StockBalance. Rejects if insufficient stock.
//   Requires `inventory:issue`. Audit recorded.
//
// NEGATIVE STOCK PREVENTION: The decreaseBalance primitive rejects if the
// resulting balance would be < 0. This is enforced server-side inside the
// transaction.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, ok, badRequest, notFound, auditFromCtx, notDeleted } from "@/lib/api-helpers";
import {
  nextInventoryRefNumber,
  issueStock,
  validateQuantity,
  InsufficientStockError,
} from "@/lib/inventory-utils";
import { toMoney } from "@/lib/finance/money";

const decimalString = z.string().regex(/^\d+(\.\d{1,4})?$/, "Must be a positive decimal string");

const IssueSchema = z.object({
  inventoryItemId: z.string().min(1, "inventoryItemId is required"),
  warehouseId: z.string().min(1, "warehouseId is required"),
  quantity: decimalString,
  reason: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  employeeId: z.string().optional(),
});

const PROJECT_TERMINAL = new Set(["completed", "cancelled"]);
const TASK_TERMINAL = new Set(["completed", "cancelled"]);

export async function POST(req: NextRequest) {
  const auth = await authorize("inventory", "issue");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = IssueSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  let qtyStr: string;
  try { qtyStr = validateQuantity(d.quantity); } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Invalid quantity.");
  }
  const quantity = toMoney(qtyStr);

  // Validate item
  const item = await db.inventoryItem.findFirst({
    where: { id: d.inventoryItemId, ...notDeleted() },
    select: { id: true, itemCode: true, name: true, active: true },
  });
  if (!item) return notFound("Inventory item not found.");
  if (!item.active) return badRequest("Inventory item is inactive.");

  // Validate warehouse
  const wh = await db.warehouse.findFirst({
    where: { id: d.warehouseId, ...notDeleted() },
    select: { id: true, code: true, name: true, active: true },
  });
  if (!wh) return notFound("Warehouse not found.");
  if (!wh.active) return badRequest("Warehouse is inactive.");

  // Validate project (optional)
  if (d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true, status: true },
    });
    if (!project) return badRequest("Selected project does not exist.");
    if (PROJECT_TERMINAL.has(project.status)) {
      return badRequest(`Cannot issue stock to a ${project.status} project.`);
    }
  }

  // Validate task (optional)
  if (d.taskId) {
    const task = await db.task.findFirst({
      where: { id: d.taskId, ...notDeleted() },
      select: { id: true, status: true, projectId: true },
    });
    if (!task) return badRequest("Selected task does not exist.");
    if (TASK_TERMINAL.has(task.status)) {
      return badRequest(`Cannot issue stock to a ${task.status} task.`);
    }
    // Cross-field consistency: if both project and task set, task.projectId must match
    if (d.projectId && task.projectId && task.projectId !== d.projectId) {
      return badRequest("Task/project mismatch: the selected task belongs to a different project.");
    }
  }

  // Validate employee (optional)
  if (d.employeeId) {
    const emp = await db.employee.findFirst({
      where: { id: d.employeeId, ...notDeleted() },
      select: { id: true },
    });
    if (!emp) return badRequest("Selected employee does not exist.");
  }

  const year = new Date().getFullYear();

  try {
    const result = await db.$transaction(async (tx) => {
      const movementNumber = await nextInventoryRefNumber(tx, "ISS", year);
      const { movement, balanceBefore, balanceAfter } = await issueStock(tx, {
        inventoryItemId: d.inventoryItemId,
        warehouseId: d.warehouseId,
        quantity,
        movementNumber,
        ctx: {
          performedById: auth.ctx.userId,
          reason: d.reason,
          notes: d.notes,
          projectId: d.projectId,
          taskId: d.taskId,
          employeeId: d.employeeId,
        },
      });
      return { movement, balanceBefore: balanceBefore.toString(), balanceAfter: balanceAfter.toString() };
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "inventory",
      recordId: result.movement.id,
      recordType: "StockMovement",
      description: `Issued ${qtyStr} ${item.name} from ${wh.name} (movement ${result.movement.movementNumber})`,
      newValue: {
        movementNumber: result.movement.movementNumber,
        movementType: "ISSUE",
        itemCode: item.itemCode,
        warehouseCode: wh.code,
        quantity: qtyStr,
        balanceBefore: result.balanceBefore,
        balanceAfter: result.balanceAfter,
        projectId: d.projectId,
        taskId: d.taskId,
        employeeId: d.employeeId,
      },
    });

    return ok(result, 201);
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return badRequest(err.message);
    }
    throw err;
  }
}
