// ============================================================================
// LBMS CRM API — Customer detail
// ----------------------------------------------------------------------------
// GET   /api/customers/[id]   single customer with contacts, recent activities
//                             (5), recent journals (10). customers:view.
// PATCH /api/customers/[id]   update customer fields. customerNumber is
//                             immutable. Validates email uniqueness, account
//                             manager existence. customers:edit. Audit records
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
import { CUSTOMER_TYPES, CUSTOMER_STATUSES } from "@/app/api/customers/route";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/customers/[id]
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("customers", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const customer = await db.customer.findFirst({
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
      _count: {
        select: {
          contacts: { where: { status: "active" } },
          activities: {},
          journals: { where: { status: "posted" } },
        },
      },
    },
  });

  if (!customer) return notFound("Customer not found.");

  return ok(customer);
}

// ---------------------------------------------------------------------------
// PATCH /api/customers/[id]
// ---------------------------------------------------------------------------
const UpdateCustomerSchema = z.object({
  // customerNumber is intentionally omitted — it is immutable.
  customerType: z.enum(CUSTOMER_TYPES).optional(),
  legalName: z.string().max(200).nullable().optional(),
  tradingName: z.string().max(200).nullable().optional(),
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
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
  status: z.enum(CUSTOMER_STATUSES).optional(),
  customerSince: dateString.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("customers", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = UpdateCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Block any attempt to change customerNumber (immutable per spec)
  if (typeof (body as Record<string, unknown>)?.customerNumber !== "undefined") {
    return badRequest("Customer number is immutable and cannot be changed.");
  }

  const existing = await db.customer.findFirst({
    where: { id, ...notDeleted() },
  });
  if (!existing) return notFound("Customer not found.");

  // Build the update payload — only fields explicitly present in the body
  // are written. Empty strings are normalised to null where appropriate.
  const data: Record<string, unknown> = {};

  const nullableStringFields = [
    "legalName",
    "tradingName",
    "firstName",
    "lastName",
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

  // customerType / status (enums)
  if (d.customerType !== undefined) data.customerType = d.customerType;
  if (d.status !== undefined) data.status = d.status;

  // customerSince (date)
  if (d.customerSince !== undefined) {
    data.customerSince = d.customerSince ? new Date(d.customerSince) : null;
  }

  // accountManagerId (nullable FK)
  if (d.accountManagerId !== undefined) {
    data.accountManagerId = d.accountManagerId || null;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Validation of referenced entities / unique constraints
  // ───────────────────────────────────────────────────────────────────────

  // email uniqueness (when changing to a non-null value different from current)
  if (
    data.email !== undefined &&
    data.email !== null &&
    data.email !== existing.email
  ) {
    const dup = await db.customer.findFirst({
      where: {
        email: data.email as string,
        NOT: { id },
        ...notDeleted(),
      },
      select: { id: true },
    });
    if (dup) return badRequest("A customer with this email already exists.");
  }

  // accountManager — must exist + be non-deleted
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
  // through the dedicated /archive endpoint (which enforces the
  // posted-journals guard).
  if (data.status === "archived") {
    return badRequest(
      "Use the dedicated archive endpoint to archive a customer (POST /api/customers/[id]/archive).",
    );
  }

  if (Object.keys(data).length === 0) {
    return badRequest("No fields provided to update.");
  }

  // Stamp updatedById + updatedAt for audit trail
  data.updatedById = auth.ctx.userId;
  data.updatedAt = new Date();

  const updated = await db.customer.update({
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
    module: "customers",
    recordId: updated.id,
    recordType: "Customer",
    description: `Updated customer ${updated.customerNumber} (${
      updated.tradingName ||
      updated.legalName ||
      [updated.firstName, updated.lastName].filter(Boolean).join(" ") ||
      updated.customerNumber
    })`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}
