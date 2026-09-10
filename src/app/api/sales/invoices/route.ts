// ============================================================================
// LBMS Phase 10 API — Invoice collection
// ----------------------------------------------------------------------------
// GET  /api/sales/invoices   paginated, searchable, filterable list with
//   derived `overdue` flag (computed from dueDate + balanceDue + status, not
//   stored). Filters: status, customerId, projectId, salesOrderId, overdue.
//   Requires `sales:view`.
// POST /api/sales/invoices   create a draft invoice (auto INV-YYYY-NNNNNN).
//   dueDate is REQUIRED. Optional salesOrderId (if provided, must be confirmed/
//   processing/completed + same customer). Validates customerId exists + not
//   archived, projectId not terminal. Requires `sales:create`.
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
import { nextSalesRefNumber, isInvoiceOverdue } from "@/lib/sales-utils";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/sales/invoices
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
  const salesOrderId = sp.get("salesOrderId")?.trim() || undefined;
  const overdueOnly = sp.get("overdue") === "true";

  const where: Record<string, unknown> = {
    ...notDeleted(),
    ...(search ? { invoiceNumber: { contains: search } } : {}),
    ...(status ? { status } : {}),
    ...(customerId ? { customerId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(salesOrderId ? { salesOrderId } : {}),
  };

  const [total, rawItems] = await Promise.all([
    db.invoice.count({ where }),
    db.invoice.findMany({
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
        salesOrder: { select: { id: true, orderNumber: true, status: true } },
        createdBy: { select: { id: true, username: true } },
      },
    }),
  ]);

  // Derive `overdue` flag client-side of DB (it's a derived field, not stored).
  const items = rawItems.map((inv) => ({
    ...inv,
    overdue: isInvoiceOverdue({
      dueDate: inv.dueDate,
      balanceDue: inv.balanceDue,
      status: inv.status,
    }),
  }));

  // If overdue filter requested, narrow down (post-filter; cheap on small sets).
  const finalItems = overdueOnly ? items.filter((i) => i.overdue) : items;
  const finalTotal = overdueOnly ? finalItems.length : total;

  return ok({
    items: finalItems,
    pagination: { page, pageSize, total: finalTotal, totalPages: Math.ceil(finalTotal / pageSize) },
  });
}

// ---------------------------------------------------------------------------
// POST /api/sales/invoices
// ---------------------------------------------------------------------------
const CreateInvoiceSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  salesOrderId: z.string().optional(),
  projectId: z.string().optional(),
  issueDate: dateString.optional(),
  dueDate: dateString.min(1, "Due date is required"),
  notes: z.string().max(5000).optional(),
  terms: z.string().max(5000).optional(),
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

  const parsed = CreateInvoiceSchema.safeParse(body);
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
    return badRequest(`Cannot create an invoice for a ${customer.status} customer.`);
  }

  // --- Validate projectId ---
  if (d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true, projectNumber: true, name: true, status: true },
    });
    if (!project) return badRequest("Selected project does not exist or is archived.");
    if (PROJECT_TERMINAL.has(project.status)) {
      return badRequest(`Cannot create an invoice against a ${project.status} project.`);
    }
  }

  // --- Validate salesOrderId ---
  if (d.salesOrderId) {
    const order = await db.salesOrder.findFirst({
      where: { id: d.salesOrderId, ...notDeleted() },
      select: { id: true, orderNumber: true, status: true, customerId: true },
    });
    if (!order) return badRequest("Selected sales order does not exist or is archived.");
    if (!["confirmed", "processing", "completed"].includes(order.status)) {
      return badRequest(`Cannot invoice a ${order.status} sales order.`);
    }
    if (order.customerId !== d.customerId) {
      return badRequest("Sales order/customer mismatch: the selected order belongs to a different customer.");
    }
  }

  // --- Due date validation ---
  // Due date is required but can be in the past (for overdue scenarios).
  // We only validate that it's a valid date, not that it's after issueDate.
  // (Overdue invoices are a legitimate business state.)

  const year = new Date().getFullYear();

  try {
    const created = await db.$transaction(async (tx) => {
      const invoiceNumber = await nextSalesRefNumber(tx, "INV", year);
      return tx.invoice.create({
        data: {
          invoiceNumber,
          customerId: d.customerId,
          salesOrderId: d.salesOrderId || null,
          projectId: d.projectId || null,
          issueDate: d.issueDate ? new Date(d.issueDate) : new Date(),
          dueDate: new Date(d.dueDate),
          status: "draft",
          notes: d.notes?.trim() || null,
          terms: d.terms?.trim() || null,
          createdById: auth.ctx.userId,
          updatedById: auth.ctx.userId,
        },
        include: {
          customer: {
            select: { id: true, customerNumber: true, tradingName: true, legalName: true },
          },
          salesOrder: { select: { id: true, orderNumber: true } },
        },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "sales",
      recordId: created.id,
      recordType: "Invoice",
      description: `Created invoice ${created.invoiceNumber} for customer ${customer.customerNumber}`,
      newValue: {
        invoiceNumber: created.invoiceNumber,
        customerId: created.customerId,
        status: created.status,
        dueDate: created.dueDate,
      },
    });

    return ok(created, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A race condition occurred while assigning the invoice number. Please retry.");
    }
    throw err;
  }
}
