// ============================================================================
// LBMS Phase 10 API — Sales Order collection
// ----------------------------------------------------------------------------
// GET  /api/sales/orders   paginated, searchable, filterable list.
//   Search matches orderNumber. Filters: status, customerId, projectId.
//   Requires `sales:view`.
// POST /api/sales/orders   create a new sales order (draft). Auto-generates
//   orderNumber as SO-YYYY-NNNNNN inside a transaction. Validates customerId
//   (exists, not archived) + projectId (exists, not cancelled) if provided.
//   Requires `sales:create`. Audit recorded.
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
import { nextSalesRefNumber } from "@/lib/sales-utils";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/sales/orders
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("sales", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const customerId = sp.get("customerId")?.trim() || undefined;
  const projectId = sp.get("projectId")?.trim() || undefined;
  const quoteId = sp.get("quoteId")?.trim() || undefined;

  const where: Record<string, unknown> = {
    ...notDeleted(),
    ...(search ? { orderNumber: { contains: search } } : {}),
    ...(status ? { status } : {}),
    ...(customerId ? { customerId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(quoteId ? { quoteId } : {}),
  };

  const [total, items] = await Promise.all([
    db.salesOrder.count({ where }),
    db.salesOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        customer: {
          select: {
            id: true, customerNumber: true, tradingName: true,
            legalName: true, firstName: true, lastName: true, status: true,
          },
        },
        project: { select: { id: true, projectNumber: true, name: true } },
        quote: { select: { id: true, quoteNumber: true } },
        createdBy: { select: { id: true, username: true } },
      },
    }),
  ]);

  return ok({
    items,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

// ---------------------------------------------------------------------------
// POST /api/sales/orders
// ---------------------------------------------------------------------------
const CreateOrderSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  projectId: z.string().optional(),
  quoteId: z.string().optional(),
  orderDate: dateString.optional(),
  notes: z.string().max(5000).optional(),
});

const PROJECT_TERMINAL = new Set(["completed", "cancelled"]);

export async function POST(req: NextRequest) {
  const auth = await authorize("sales", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateOrderSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // --- Validate customerId ---
  const customer = await db.customer.findFirst({
    where: { id: d.customerId, ...notDeleted() },
    select: { id: true, customerNumber: true, tradingName: true, legalName: true, status: true },
  });
  if (!customer) return badRequest("Selected customer does not exist or is archived.");
  if (customer.status === "archived" || customer.status === "suspended") {
    return badRequest(`Cannot create a sales order for a ${customer.status} customer.`);
  }

  // --- Validate projectId ---
  if (d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true, projectNumber: true, name: true, status: true },
    });
    if (!project) return badRequest("Selected project does not exist or is archived.");
    if (PROJECT_TERMINAL.has(project.status)) {
      return badRequest(`Cannot create a sales order against a ${project.status} project.`);
    }
  }

  // --- Validate quoteId (if provided, must be accepted or converted + match customer) ---
  if (d.quoteId) {
    const quote = await db.quote.findFirst({
      where: { id: d.quoteId, ...notDeleted() },
      select: { id: true, quoteNumber: true, status: true, customerId: true },
    });
    if (!quote) return badRequest("Selected quote does not exist or is archived.");
    if (!["accepted", "converted"].includes(quote.status)) {
      return badRequest(`Cannot create a sales order from a ${quote.status} quote.`);
    }
    if (quote.customerId !== d.customerId) {
      return badRequest("Quote/customer mismatch: the selected quote belongs to a different customer.");
    }
  }

  const year = new Date().getFullYear();

  try {
    const created = await db.$transaction(async (tx) => {
      const orderNumber = await nextSalesRefNumber(tx, "SO", year);
      return tx.salesOrder.create({
        data: {
          orderNumber,
          customerId: d.customerId,
          quoteId: d.quoteId || null,
          projectId: d.projectId || null,
          orderDate: d.orderDate ? new Date(d.orderDate) : new Date(),
          status: "draft",
          notes: d.notes?.trim() || null,
          createdById: auth.ctx.userId,
          updatedById: auth.ctx.userId,
        },
        include: {
          customer: {
            select: { id: true, customerNumber: true, tradingName: true, legalName: true },
          },
          project: { select: { id: true, projectNumber: true, name: true } },
        },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "sales",
      recordId: created.id,
      recordType: "SalesOrder",
      description: `Created sales order ${created.orderNumber} for customer ${customer.customerNumber}`,
      newValue: {
        orderNumber: created.orderNumber,
        customerId: created.customerId,
        status: created.status,
      },
    });

    return ok(created, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A race condition occurred while assigning the order number. Please retry.");
    }
    throw err;
  }
}
