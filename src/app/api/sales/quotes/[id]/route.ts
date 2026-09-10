// ============================================================================
// LBMS Phase 10 API — Quote single-record
// ----------------------------------------------------------------------------
// GET   /api/sales/quotes/[id]   fetch one quote with items + customer + project.
//   Requires `sales:view`.
// PATCH /api/sales/quotes/[id]   edit a DRAFT quote only (terminal states
//   rejected/expired/converted/cancelled + sent/accepted block edits).
//   Recomputes totals server-side. quoteNumber + customerId are immutable.
//   Requires `sales:edit`. Audit with prev+new.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
  badRequest,
  notFound,
  auditFromCtx,
  notDeleted,
} from "@/lib/api-helpers";
import {
  QUOTE_TERMINAL,
  recomputeQuoteTotals,
} from "@/lib/sales-utils";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const PatchQuoteSchema = z.object({
  projectId: z.string().nullable().optional(),
  issueDate: dateString.optional(),
  expiryDate: dateString.nullable().optional(),
  notes: z.string().max(5000).optional(),
  terms: z.string().max(5000).optional(),
});

const PROJECT_TERMINAL = new Set(["completed", "cancelled"]);

// ---------------------------------------------------------------------------
// GET /api/sales/quotes/[id]
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const quote = await db.quote.findFirst({
    where: { id, ...notDeleted() },
    include: {
      customer: {
        select: {
          id: true, customerNumber: true, tradingName: true, legalName: true,
          firstName: true, lastName: true, email: true, phone: true, status: true,
          country: true, city: true,
        },
      },
      project: { select: { id: true, projectNumber: true, name: true, status: true } },
      acceptedBy: { select: { id: true, username: true } },
      createdBy: { select: { id: true, username: true } },
      updatedBy: { select: { id: true, username: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          inventoryItem: {
            select: { id: true, itemCode: true, name: true, unitOfMeasure: true },
          },
        },
      },
    },
  });
  if (!quote) return notFound("Quote not found.");

  return ok(quote);
}

// ---------------------------------------------------------------------------
// PATCH /api/sales/quotes/[id]
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("sales", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await db.quote.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Quote not found.");

  // Edits only allowed in draft. Sent/accepted are immutable (line-item
  // mutations happen via the lifecycle flow). Terminal states block.
  if (existing.status !== "draft") {
    if (QUOTE_TERMINAL.has(existing.status)) {
      return badRequest(`Cannot edit a ${existing.status} quote.`);
    }
    return badRequest(
      `Cannot edit a ${existing.status} quote. Only draft quotes may be edited.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = PatchQuoteSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // --- Validate projectId ---
  if (d.projectId !== undefined && d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true, status: true },
    });
    if (!project) return badRequest("Selected project does not exist or is archived.");
    if (PROJECT_TERMINAL.has(project.status)) {
      return badRequest(`Cannot link a quote against a ${project.status} project.`);
    }
  }

  // --- Expiry must be after issue date ---
  const newIssue = d.issueDate ? new Date(d.issueDate) : existing.issueDate;
  const newExpiry = d.expiryDate !== undefined
    ? (d.expiryDate ? new Date(d.expiryDate) : null)
    : existing.expiryDate;
  if (newExpiry && newExpiry <= newIssue) {
    return badRequest("Expiry date must be after the issue date.");
  }

  const data: Record<string, unknown> = { updatedById: auth.ctx.userId };
  if (d.projectId !== undefined) data.projectId = d.projectId || null;
  if (d.issueDate !== undefined) data.issueDate = new Date(d.issueDate);
  if (d.expiryDate !== undefined) data.expiryDate = d.expiryDate ? new Date(d.expiryDate) : null;
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;
  if (d.terms !== undefined) data.terms = d.terms?.trim() || null;

  const updated = await db.$transaction(async (tx) => {
    const u = await tx.quote.update({
      where: { id },
      data,
    });
    // Recompute totals from current items (no-op if none).
    const totals = await recomputeQuoteTotals(tx, id);
    const finalQ = await tx.quote.update({
      where: { id },
      data: {
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
      },
      include: {
        customer: {
          select: { id: true, customerNumber: true, tradingName: true, legalName: true },
        },
        project: { select: { id: true, projectNumber: true, name: true } },
        items: { orderBy: { createdAt: "asc" } },
      },
    });
    return { finalQ, totals };
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "sales",
    recordId: updated.finalQ.id,
    recordType: "Quote",
    description: `Updated quote ${updated.finalQ.quoteNumber}`,
    previousValue: existing,
    newValue: { ...updated.finalQ, totals: updated.totals },
  });

  return ok(updated.finalQ);
}
