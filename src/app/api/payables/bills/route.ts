// ============================================================================
// LBMS Phase 11 API — Supplier Bill collection
// ----------------------------------------------------------------------------
// GET  /api/payables/bills   paginated, searchable, filterable list with
//   derived `overdue` flag (computed from dueDate + balanceDue + status).
//   Filters: status, supplierId, projectId. Search matches billNumber.
//   Requires `payables:view`.
// POST /api/payables/bills   create a draft bill (auto SB-YYYY-NNNNNN).
//   supplierId REQUIRED + must be active. Optional projectId + purchaseOrderId
//   + goodsReceiptId. Optional billDate + dueDate. Requires `payables:create`.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
  badRequest,
  auditFromCtx,
  notDeleted,
} from "@/lib/api-helpers";
import { nextPayableRefNumber, isBillOverdue } from "@/lib/ap-utils";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/payables/bills
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("payables", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const supplierId = sp.get("supplierId")?.trim() || undefined;
  const projectId = sp.get("projectId")?.trim() || undefined;
  const overdueOnly = sp.get("overdue") === "true";

  const where: Record<string, unknown> = {
    ...notDeleted(),
    ...(search ? { billNumber: { contains: search } } : {}),
    ...(status ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(projectId ? { projectId } : {}),
  };

  const [total, rawItems] = await Promise.all([
    db.supplierBill.count({ where }),
    db.supplierBill.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        supplier: {
          select: {
            id: true, supplierNumber: true, tradingName: true, legalName: true, status: true,
          },
        },
        project: { select: { id: true, projectNumber: true, name: true } },
        createdBy: { select: { id: true, username: true } },
        approvedBy: { select: { id: true, username: true } },
        _count: { select: { items: true, payments: true } },
      },
    }),
  ]);

  // Derive `overdue` flag (computed, not stored).
  const items = rawItems.map((b) => ({
    ...b,
    overdue: isBillOverdue({
      dueDate: b.dueDate,
      balanceDue: b.balanceDue,
      status: b.status,
    }),
  }));

  const finalItems = overdueOnly ? items.filter((i) => i.overdue) : items;
  const finalTotal = overdueOnly ? finalItems.length : total;

  return ok({
    items: finalItems,
    pagination: { page, pageSize, total: finalTotal, totalPages: Math.ceil(finalTotal / pageSize) },
  });
}

// ---------------------------------------------------------------------------
// POST /api/payables/bills
// ---------------------------------------------------------------------------
const CreateBillSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  supplierRef: z.string().max(200).optional(),
  projectId: z.string().optional(),
  purchaseOrderId: z.string().optional(),
  goodsReceiptId: z.string().optional(),
  billDate: dateString.optional(),
  dueDate: dateString.optional(),
  notes: z.string().max(5000).optional(),
});

const PROJECT_TERMINAL = new Set(["completed", "cancelled"]);

export async function POST(req: NextRequest) {
  const auth = await authorize("payables", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateBillSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // --- Validate supplier ---
  const supplier = await db.supplier.findFirst({
    where: { id: d.supplierId, ...notDeleted() },
    select: { id: true, supplierNumber: true, tradingName: true, legalName: true, status: true },
  });
  if (!supplier) return badRequest("Selected supplier does not exist or is archived.");
  if (supplier.status === "archived" || supplier.status === "suspended") {
    return badRequest(`Cannot create a bill for a ${supplier.status} supplier.`);
  }

  // --- Validate projectId ---
  if (d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true, projectNumber: true, name: true, status: true },
    });
    if (!project) return badRequest("Selected project does not exist or is archived.");
    if (PROJECT_TERMINAL.has(project.status)) {
      return badRequest(`Cannot create a bill against a ${project.status} project.`);
    }
  }

  // --- Validate purchaseOrderId (if provided, supplier must match) ---
  if (d.purchaseOrderId) {
    const po = await db.purchaseOrder.findFirst({
      where: { id: d.purchaseOrderId },
      select: { id: true, purchaseOrderNumber: true, status: true, supplierId: true },
    });
    if (!po) return badRequest("Selected purchase order does not exist.");
    if (po.supplierId !== d.supplierId) {
      return badRequest("Purchase order/supplier mismatch: the selected PO belongs to a different supplier.");
    }
  }

  // --- Validate goodsReceiptId (if provided, supplier must match) ---
  if (d.goodsReceiptId) {
    const gr = await db.goodsReceipt.findFirst({
      where: { id: d.goodsReceiptId },
      select: { id: true, receiptNumber: true, supplierId: true },
    });
    if (!gr) return badRequest("Selected goods receipt does not exist.");
    if (gr.supplierId !== d.supplierId) {
      return badRequest("Goods receipt/supplier mismatch: the selected GR belongs to a different supplier.");
    }
  }

  const year = new Date().getFullYear();

  try {
    const created = await db.$transaction(async (tx) => {
      const billNumber = await nextPayableRefNumber(tx, "SB", year);
      return tx.supplierBill.create({
        data: {
          billNumber,
          supplierId: d.supplierId,
          supplierRef: d.supplierRef?.trim() || null,
          projectId: d.projectId || null,
          purchaseOrderId: d.purchaseOrderId || null,
          goodsReceiptId: d.goodsReceiptId || null,
          billDate: d.billDate ? new Date(d.billDate) : new Date(),
          dueDate: d.dueDate ? new Date(d.dueDate) : null,
          status: "draft",
          notes: d.notes?.trim() || null,
          createdById: auth.ctx.userId,
          updatedById: auth.ctx.userId,
        },
        include: {
          supplier: {
            select: { id: true, supplierNumber: true, tradingName: true, legalName: true },
          },
        },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "payables",
      recordId: created.id,
      recordType: "SupplierBill",
      description: `Created supplier bill ${created.billNumber} for supplier ${supplier.supplierNumber}`,
      newValue: {
        billNumber: created.billNumber,
        supplierId: created.supplierId,
        status: created.status,
        dueDate: created.dueDate,
      },
    });

    return ok(created, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A race condition occurred while assigning the bill number. Please retry.");
    }
    throw err;
  }
}
