// ============================================================================
// LBMS Phase 10 API — Quote collection
// ----------------------------------------------------------------------------
// GET  /api/sales/quotes   paginated, searchable, filterable list of quotes.
//   Search matches quoteNumber. Filters: status, customerId, projectId.
//   Requires `sales:view`.
// POST /api/sales/quotes   create a new quote (draft). Auto-generates
//   quoteNumber as QT-YYYY-NNNNNN inside a transaction. Validates customerId
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
// GET /api/sales/quotes
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

  const where: Record<string, unknown> = {
    ...notDeleted(),
    ...(search ? { quoteNumber: { contains: search } } : {}),
    ...(status ? { status } : {}),
    ...(customerId ? { customerId } : {}),
    ...(projectId ? { projectId } : {}),
  };

  const [total, items] = await Promise.all([
    db.quote.count({ where }),
    db.quote.findMany({
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
        acceptedBy: { select: { id: true, username: true } },
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
// POST /api/sales/quotes
// ---------------------------------------------------------------------------
const CreateQuoteSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  projectId: z.string().optional(),
  issueDate: dateString.optional(),
  expiryDate: dateString.optional(),
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

  const parsed = CreateQuoteSchema.safeParse(body);
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
    return badRequest(`Cannot create a quote for a ${customer.status} customer.`);
  }

  // --- Validate projectId ---
  if (d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true, projectNumber: true, name: true, status: true },
    });
    if (!project) return badRequest("Selected project does not exist or is archived.");
    if (PROJECT_TERMINAL.has(project.status)) {
      return badRequest(`Cannot create a quote against a ${project.status} project.`);
    }
  }

  // --- Expiry must be after issue date (if both supplied) ---
  const issueDate = d.issueDate ? new Date(d.issueDate) : new Date();
  if (d.expiryDate && new Date(d.expiryDate) <= issueDate) {
    return badRequest("Expiry date must be after the issue date.");
  }

  const year = new Date().getFullYear();

  try {
    const created = await db.$transaction(async (tx) => {
      const quoteNumber = await nextSalesRefNumber(tx, "QT", year);
      return tx.quote.create({
        data: {
          quoteNumber,
          customerId: d.customerId,
          projectId: d.projectId || null,
          issueDate,
          expiryDate: d.expiryDate ? new Date(d.expiryDate) : null,
          notes: d.notes?.trim() || null,
          terms: d.terms?.trim() || null,
          createdById: auth.ctx.userId,
          updatedById: auth.ctx.userId,
        },
        include: {
          customer: {
            select: {
              id: true, customerNumber: true, tradingName: true, legalName: true,
            },
          },
          project: { select: { id: true, projectNumber: true, name: true } },
        },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "sales",
      recordId: created.id,
      recordType: "Quote",
      description: `Created quote ${created.quoteNumber} for customer ${customer.customerNumber}`,
      newValue: {
        quoteNumber: created.quoteNumber,
        customerId: created.customerId,
        status: created.status,
      },
    });

    return ok(created, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A race condition occurred while assigning the quote number. Please retry.");
    }
    throw err;
  }
}
