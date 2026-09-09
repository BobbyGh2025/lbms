// ============================================================================
// LBMS CRM API — Customer collection
// ----------------------------------------------------------------------------
// GET  /api/customers   paginated, searchable, filterable list of customers.
//                       Search matches customerNumber, tradingName, legalName,
//                       email, phone. Filters: status, customerType,
//                       accountManagerId. Each row includes contact count +
//                       activity count. customers:view.
// POST /api/customers   create a new customer record. Auto-generates
//                       `customerNumber` as CUS-YYYY-NNNNNN via the
//                       RelationshipRefCounter concurrency-safe counter,
//                       inside a single db.$transaction. Validates unique
//                       email (among non-archived), valid accountManager
//                       (Employee FK). customers:create. Audit recorded.
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
import { nextCustomerNumber } from "@/lib/relationship-utils";

// ---------------------------------------------------------------------------
// Constants — shared across customer routes
// ---------------------------------------------------------------------------
export const CUSTOMER_TYPES = [
  "individual",
  "business",
  "organization",
  "government",
  "ngo",
  "other",
] as const;

export const CUSTOMER_STATUSES = [
  "active",
  "inactive",
  "prospect",
  "suspended",
  "archived",
] as const;

const SORTABLE_FIELDS = [
  "customerNumber",
  "tradingName",
  "legalName",
  "email",
  "createdAt",
  "updatedAt",
  "customerSince",
  "status",
] as const;

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/customers
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("customers", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const customerType = sp.get("customerType")?.trim() || undefined;
  const accountManagerId = sp.get("accountManagerId")?.trim() || undefined;

  const sortByParam = sp.get("sortBy")?.trim() || "createdAt";
  const sortDir = sp.get("sortDir")?.trim().toLowerCase() === "asc" ? "asc" : "desc";
  const sortBy = (SORTABLE_FIELDS as readonly string[]).includes(sortByParam)
    ? sortByParam
    : "createdAt";

  const where: Record<string, unknown> = {
    ...notDeleted(),
    ...(search
      ? {
          OR: [
            { customerNumber: { contains: search } },
            { tradingName: { contains: search } },
            { legalName: { contains: search } },
            { email: { contains: search } },
            { phone: { contains: search } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
    ...(customerType ? { customerType } : {}),
    ...(accountManagerId ? { accountManagerId } : {}),
  };

  const [total, items] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip,
      take: pageSize,
      include: {
        accountManager: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            employeeNumber: true,
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
    }),
  ]);

  return ok({
    items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/customers
// ---------------------------------------------------------------------------
const CreateCustomerSchema = z.object({
  customerType: z.enum(CUSTOMER_TYPES).optional(),
  legalName: z.string().max(200).optional(),
  tradingName: z.string().max(200).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: z.string().email("Invalid email format").optional().or(z.literal("")),
  phone: z.string().max(50).optional(),
  alternativePhone: z.string().max(50).optional(),
  website: z.string().url().optional().or(z.literal("")),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  contactPerson: z.string().max(200).optional(),
  accountManagerId: z.string().optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  customerSince: dateString.optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("customers", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Require at least one identifying name (legalName, tradingName, or firstName/lastName)
  const trimmedLegalName = d.legalName?.trim() || null;
  const trimmedTradingName = d.tradingName?.trim() || null;
  const trimmedFirstName = d.firstName?.trim() || null;
  const trimmedLastName = d.lastName?.trim() || null;
  if (!trimmedLegalName && !trimmedTradingName && !trimmedFirstName && !trimmedLastName) {
    return badRequest(
      "At least one of legalName, tradingName, firstName, or lastName is required.",
    );
  }

  // Normalise email — empty string → undefined; lowercase to keep uniqueness deterministic
  const email =
    d.email && d.email.trim() ? d.email.trim().toLowerCase() : undefined;

  // Normalise website
  const website = d.website && d.website.trim() ? d.website.trim() : undefined;

  // Unique email check (among non-archived customers) when provided
  if (email) {
    const existingEmail = await db.customer.findFirst({
      where: { email, ...notDeleted() },
      select: { id: true },
    });
    if (existingEmail) {
      return badRequest("A customer with this email already exists.");
    }
  }

  // Validate accountManager (Employee FK) when provided
  if (d.accountManagerId) {
    const mgr = await db.employee.findFirst({
      where: { id: d.accountManagerId, ...notDeleted() },
      select: { id: true, fullName: true },
    });
    if (!mgr) {
      return badRequest("Selected account manager does not exist or is inactive.");
    }
  }

  const year = new Date().getFullYear();

  try {
    const created = await db.$transaction(async (tx) => {
      const customerNumber = await nextCustomerNumber(tx, year);

      return tx.customer.create({
        data: {
          customerNumber,
          customerType: d.customerType ?? "business",
          legalName: trimmedLegalName,
          tradingName: trimmedTradingName,
          firstName: trimmedFirstName,
          lastName: trimmedLastName,
          email: email ?? null,
          phone: d.phone?.trim() || null,
          alternativePhone: d.alternativePhone?.trim() || null,
          website: website ?? null,
          address: d.address?.trim() || null,
          city: d.city?.trim() || null,
          region: d.region?.trim() || null,
          country: d.country?.trim() || "Ghana",
          industry: d.industry?.trim() || null,
          contactPerson: d.contactPerson?.trim() || null,
          accountManagerId: d.accountManagerId || null,
          status: d.status ?? "active",
          customerSince: d.customerSince ? new Date(d.customerSince) : null,
          notes: d.notes?.trim() || null,
          createdById: auth.ctx.userId,
          updatedById: auth.ctx.userId,
        },
        include: {
          accountManager: {
            select: { id: true, fullName: true, employeeNumber: true },
          },
        },
      });
    });

    const displayLabel =
      created.tradingName ||
      created.legalName ||
      [created.firstName, created.lastName].filter(Boolean).join(" ") ||
      created.customerNumber;

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "customers",
      recordId: created.id,
      recordType: "Customer",
      description: `Created customer ${created.customerNumber} (${displayLabel})`,
      newValue: created,
    });

    return ok(created, 201);
  } catch (err) {
    // Surface the most common race-condition failure (number uniqueness) as 400.
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest(
        "A race condition occurred while assigning the customer number. Please retry.",
      );
    }
    throw err;
  }
}
