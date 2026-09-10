// ============================================================================
// LBMS Phase 7 API — Purchase Order collection
// ----------------------------------------------------------------------------
// GET  /api/procurement/orders   paginated, searchable, filterable list.
//   Search matches purchaseOrderNumber. Filters: status, supplierId,
//   projectId, requestedById. Requires `procurement:view`.
// POST /api/procurement/orders   create a new purchase order (draft or
//   pending_approval). Auto-generates purchaseOrderNumber as PO-YYYY-NNNNNN.
//   Validates supplierId (required, exists, not archived), projectId (exists,
//   not cancelled), procurementRequestId (optional, must be approved & not
//   already converted). Requires `procurement:create`. Audit recorded.
//
// FINANCE BOUNDARY: This endpoint does NOT create any Journal entries. PO
// totals are *commitments* only. The handoff to Finance/AP is deferred.
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
import {
  nextPurchaseOrderNumber,
  PURCHASE_ORDER_STATUSES,
} from "@/lib/procurement-utils";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/procurement/orders
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("procurement", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const supplierId = sp.get("supplierId")?.trim() || undefined;
  const projectId = sp.get("projectId")?.trim() || undefined;
  const requestedById = sp.get("requestedById")?.trim() || undefined;

  const where: Record<string, unknown> = {
    ...notDeleted(),
    ...(search ? { purchaseOrderNumber: { contains: search } } : {}),
    ...(status ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(requestedById ? { requestedById } : {}),
  };

  const [total, items] = await Promise.all([
    db.purchaseOrder.count({ where }),
    db.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        supplier: {
          select: { id: true, supplierNumber: true, tradingName: true, legalName: true },
        },
        project: { select: { id: true, projectNumber: true, name: true } },
        procurementRequest: { select: { id: true, requestNumber: true, title: true } },
        requestedBy: { select: { id: true, username: true } },
        approvedBy: { select: { id: true, username: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  return ok({
    items,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

// ---------------------------------------------------------------------------
// POST /api/procurement/orders
// ---------------------------------------------------------------------------
const CreatePOSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  procurementRequestId: z.string().optional(),
  projectId: z.string().optional(),
  requestedById: z.string().min(1, "Requester is required"),
  orderDate: dateString.optional(),
  expectedDeliveryDate: dateString.optional(),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  notes: z.string().max(5000).optional(),
});

const PROJECT_TERMINAL = new Set(["completed", "cancelled"]);

export async function POST(req: NextRequest) {
  const auth = await authorize("procurement", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreatePOSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // --- Validate supplier (required) ---
  const supplier = await db.supplier.findFirst({
    where: { id: d.supplierId, ...notDeleted() },
    select: { id: true, supplierNumber: true, tradingName: true, legalName: true, status: true },
  });
  if (!supplier) return badRequest("Selected supplier does not exist or is archived.");
  if (supplier.status === "archived") return badRequest("Selected supplier is archived.");

  // --- Validate requestedById (User) ---
  const requester = await db.user.findFirst({
    where: { id: d.requestedById },
    select: { id: true, username: true },
  });
  if (!requester) return badRequest("Selected requester (user) does not exist.");

  // --- Validate projectId ---
  if (d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true, projectNumber: true, name: true, status: true },
    });
    if (!project) return badRequest("Selected project does not exist or is archived.");
    if (PROJECT_TERMINAL.has(project.status)) {
      return badRequest(`Cannot create a purchase order against a ${project.status} project.`);
    }
  }

  // --- Validate procurementRequestId (if linking, must be approved + not already converted) ---
  let linkedRequest: { id: string; requestNumber: string; status: string; convertedAt: Date | null } | null = null;
  if (d.procurementRequestId) {
    linkedRequest = await db.procurementRequest.findFirst({
      where: { id: d.procurementRequestId, ...notDeleted() },
      select: { id: true, requestNumber: true, status: true, convertedAt: true },
    });
    if (!linkedRequest) return badRequest("Selected procurement request does not exist.");
    if (linkedRequest.status !== "approved") {
      return badRequest(
        `Cannot create a PO from a ${linkedRequest.status} request. Only approved requests may be converted.`,
      );
    }
    if (linkedRequest.convertedAt) {
      return badRequest("This procurement request has already been converted to a purchase order.");
    }
  }

  const year = new Date().getFullYear();
  // Effective status: caller may set draft or pending_approval; default draft.
  const status = d.status ?? "draft";
  // A pending_approval PO should be submitted for approval — but we allow the
  // caller to set it directly (the approve endpoint handles the rest).
  if (status !== "draft" && status !== "pending_approval") {
    return badRequest(
      "A new purchase order may only be created in draft or pending_approval status.",
    );
  }

  try {
    const created = await db.$transaction(async (tx) => {
      const purchaseOrderNumber = await nextPurchaseOrderNumber(tx, year);
      const po = await tx.purchaseOrder.create({
        data: {
          purchaseOrderNumber,
          supplierId: d.supplierId,
          procurementRequestId: d.procurementRequestId || null,
          projectId: d.projectId || null,
          requestedById: d.requestedById,
          orderDate: d.orderDate ? new Date(d.orderDate) : new Date(),
          expectedDeliveryDate: d.expectedDeliveryDate ? new Date(d.expectedDeliveryDate) : null,
          status,
          notes: d.notes?.trim() || null,
          createdById: auth.ctx.userId,
          updatedById: auth.ctx.userId,
        },
        include: {
          supplier: { select: { id: true, supplierNumber: true, tradingName: true, legalName: true } },
          project: { select: { id: true, projectNumber: true, name: true } },
        },
      });

      // If linked to a procurement request, mark it converted.
      if (linkedRequest) {
        await tx.procurementRequest.update({
          where: { id: linkedRequest.id },
          data: {
            status: "converted",
            convertedAt: new Date(),
            updatedById: auth.ctx.userId,
          },
        });
      }

      return po;
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "procurement",
      recordId: created.id,
      recordType: "PurchaseOrder",
      description: `Created purchase order ${created.purchaseOrderNumber} for ${supplier.tradingName ?? supplier.legalName ?? supplier.supplierNumber}`,
      newValue: { purchaseOrderNumber: created.purchaseOrderNumber, status: created.status },
    });

    return ok(created, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A race condition occurred while assigning the PO number. Please retry.");
    }
    throw err;
  }
}
