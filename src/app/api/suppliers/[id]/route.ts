// ============================================================================
// LBMS CRM API — Supplier detail
// ----------------------------------------------------------------------------
// GET   /api/suppliers/[id]   single supplier with contacts, recent activities
//                             (5), recent journals (10). suppliers:view.
// PATCH /api/suppliers/[id]   update supplier fields. supplierNumber is
//                             immutable. Validates email uniqueness, account
//                             manager existence. suppliers:edit. Audit records
//                             previousValue + newValue.
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
import { SUPPLIER_TYPES, SUPPLIER_STATUSES } from "@/app/api/suppliers/route";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/suppliers/[id]
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("suppliers", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const supplier = await db.supplier.findFirst({
    where: { id, ...notDeleted() },
    include: {
      accountManager: {
        select: {
          id: true,
          fullName: true,
          employeeId: true,
          employeeNumber: true,
        },
      },
      contacts: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          assignedTo: {
            select: { id: true, fullName: true, employeeNumber: true },
          },
        },
      },
      journals: {
        orderBy: { transactionDate: "desc" },
        take: 10,
        where: { status: "posted" },
        select: {
          id: true,
          reference: true,
          transactionType: true,
          transactionDate: true,
          amount: true,
          currency: true,
          status: true,
          description: true,
        },
      },
      // Phase 7: include purchase orders for the supplier profile view
      purchaseOrders: {
        orderBy: { createdAt: "desc" },
        take: 20,
        where: { deletedAt: null },
        select: {
          id: true,
          purchaseOrderNumber: true,
          status: true,
          orderDate: true,
          expectedDeliveryDate: true,
          total: true,
          currency: true,
          _count: { select: { items: true } },
        },
      },
      _count: {
        select: {
          contacts: { where: { status: "active" } },
          activities: {},
          journals: { where: { status: "posted" } },
        },
      },
    },
  });

  if (!supplier) return notFound("Supplier not found.");

  return ok(supplier);
}

// ---------------------------------------------------------------------------
// PATCH /api/suppliers/[id]
// ---------------------------------------------------------------------------
const UpdateSupplierSchema = z.object({
  // supplierNumber is intentionally omitted — it is immutable.
  supplierType: z.enum(SUPPLIER_TYPES).optional(),
  legalName: z.string().max(200).nullable().optional(),
  tradingName: z.string().max(200).nullable().optional(),
  email: z.string().email("Invalid email format").optional().or(z.literal("")).nullable(),
  phone: z.string().max(50).nullable().optional(),
  alternativePhone: z.string().max(50).nullable().optional(),
  website: z.string().url().optional().or(z.literal("")).nullable(),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  region: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  industry: z.string().max(100).nullable().optional(),
  contactPerson: z.string().max(200).nullable().optional(),
  accountManagerId: z.string().nullable().optional(),
  status: z.enum(SUPPLIER_STATUSES).optional(),
  supplierSince: dateString.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("suppliers", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = UpdateSupplierSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Block any attempt to change supplierNumber (immutable per spec)
  if (typeof (body as Record<string, unknown>)?.supplierNumber !== "undefined") {
    return badRequest("Supplier number is immutable and cannot be changed.");
  }

  const existing = await db.supplier.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Supplier not found.");

  const data: Record<string, unknown> = {};

  const nullableStringFields = [
    "legalName",
    "tradingName",
    "phone",
    "alternativePhone",
    "address",
    "city",
    "region",
    "country",
    "industry",
    "contactPerson",
    "notes",
  ] as const;

  for (const f of nullableStringFields) {
    const v = d[f];
    if (v === undefined) continue;
    data[f] = v === null ? null : v.trim() || null;
  }

  // website (URL — keep empty → null)
  if (d.website !== undefined) {
    data.website =
      typeof d.website === "string" && d.website.trim() ? d.website.trim() : null;
  }

  // email (lowercase, unique-checked, empty → null)
  if (d.email !== undefined) {
    const trimmed =
      typeof d.email === "string" ? d.email.trim().toLowerCase() : "";
    data.email = trimmed || null;
  }

  // supplierType / status (enums)
  if (d.supplierType !== undefined) data.supplierType = d.supplierType;
  if (d.status !== undefined) data.status = d.status;

  // supplierSince (date)
  if (d.supplierSince !== undefined) {
    data.supplierSince = d.supplierSince ? new Date(d.supplierSince) : null;
  }

  // accountManagerId (nullable FK)
  if (d.accountManagerId !== undefined) {
    data.accountManagerId = d.accountManagerId || null;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Validation of referenced entities / unique constraints
  // ───────────────────────────────────────────────────────────────────────

  if (
    data.email !== undefined &&
    data.email !== null &&
    data.email !== existing.email
  ) {
    const dup = await db.supplier.findFirst({
      where: {
        email: data.email as string,
        NOT: { id },
        ...notDeleted(),
      },
      select: { id: true },
    });
    if (dup) return badRequest("A supplier with this email already exists.");
  }

  if (data.accountManagerId !== undefined && data.accountManagerId !== null) {
    const mgr = await db.employee.findFirst({
      where: { id: data.accountManagerId as string, ...notDeleted() },
      select: { id: true, fullName: true },
    });
    if (!mgr) {
      return badRequest("Selected account manager does not exist or is inactive.");
    }
  }

  // Block any direct attempt to archive via PATCH — archiving must go
  // through the dedicated /archive endpoint.
  if (data.status === "archived") {
    return badRequest(
      "Use the dedicated archive endpoint to archive a supplier (POST /api/suppliers/[id]/archive).",
    );
  }

  if (Object.keys(data).length === 0) {
    return badRequest("No fields provided to update.");
  }

  data.updatedById = auth.ctx.userId;
  data.updatedAt = new Date();

  const updated = await db.supplier.update({
    where: { id },
    data,
    include: {
      accountManager: {
        select: { id: true, fullName: true, employeeNumber: true },
      },
    },
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "suppliers",
    recordId: updated.id,
    recordType: "Supplier",
    description: `Updated supplier ${updated.supplierNumber} (${
      updated.tradingName || updated.legalName || updated.supplierNumber
    })`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
