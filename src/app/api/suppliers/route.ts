// ============================================================================
// LBMS CRM API — Supplier collection
// ----------------------------------------------------------------------------
// GET  /api/suppliers   paginated, searchable, filterable list of suppliers.
//                       Search matches supplierNumber, tradingName, legalName,
//                       email, phone. Filters: status, supplierType,
//                       accountManagerId. Each row includes contact count +
//                       activity count. suppliers:view.
// POST /api/suppliers   create a new supplier record. Auto-generates
//                       `supplierNumber` as SUP-YYYY-NNNNNN via the
//                       RelationshipRefCounter concurrency-safe counter,
//                       inside a single db.$transaction. Validates unique
//                       email (among non-archived), valid accountManager
//                       (Employee FK). suppliers:create. Audit recorded.
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
import { nextSupplierNumber } from "@/lib/relationship-utils";

// ---------------------------------------------------------------------------
// Constants — shared across supplier routes
// ---------------------------------------------------------------------------
export const SUPPLIER_TYPES = [
  "business",
  "individual",
  "contractor",
  "service_provider",
  "government",
  "other",
] as const;

export const SUPPLIER_STATUSES = [
  "active",
  "inactive",
  "suspended",
  "archived",
] as const;

const SORTABLE_FIELDS = [
  "supplierNumber",
  "tradingName",
  "legalName",
  "email",
  "createdAt",
  "updatedAt",
  "supplierSince",
  "status",
] as const;

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

// ---------------------------------------------------------------------------
// GET /api/suppliers
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("suppliers", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const supplierType = sp.get("supplierType")?.trim() || undefined;
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
            { supplierNumber: { contains: search } },
            { tradingName: { contains: search } },
            { legalName: { contains: search } },
            { email: { contains: search } },
            { phone: { contains: search } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
    ...(supplierType ? { supplierType } : {}),
    ...(accountManagerId ? { accountManagerId } : {}),
  };

  const [total, items] = await Promise.all([
    db.supplier.count({ where }),
    db.supplier.findMany({
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
// POST /api/suppliers
// ---------------------------------------------------------------------------
const CreateSupplierSchema = z.object({
  supplierType: z.enum(SUPPLIER_TYPES).optional(),
  legalName: z.string().max(200).optional(),
  tradingName: z.string().max(200).optional(),
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
  status: z.enum(SUPPLIER_STATUSES).optional(),
  supplierSince: dateString.optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("suppliers", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateSupplierSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Require at least one identifying name (legalName or tradingName)
  const trimmedLegalName = d.legalName?.trim() || null;
  const trimmedTradingName = d.tradingName?.trim() || null;
  if (!trimmedLegalName && !trimmedTradingName) {
    return badRequest("At least one of legalName or tradingName is required.");
  }

  // Normalise email
  const email =
    d.email && d.email.trim() ? d.email.trim().toLowerCase() : undefined;

  // Normalise website
  const website = d.website && d.website.trim() ? d.website.trim() : undefined;

  // Unique email check (among non-archived suppliers) when provided
  if (email) {
    const existingEmail = await db.supplier.findFirst({
      where: { email, ...notDeleted() },
      select: { id: true },
    });
    if (existingEmail) {
      return badRequest("A supplier with this email already exists.");
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
      const supplierNumber = await nextSupplierNumber(tx, year);

      return tx.supplier.create({
        data: {
          supplierNumber,
          supplierType: d.supplierType ?? "business",
          legalName: trimmedLegalName,
          tradingName: trimmedTradingName,
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
          supplierSince: d.supplierSince ? new Date(d.supplierSince) : null,
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
      created.tradingName || created.legalName || created.supplierNumber;

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "suppliers",
      recordId: created.id,
      recordType: "Supplier",
      description: `Created supplier ${created.supplierNumber} (${displayLabel})`,
      newValue: created,
    });

    return ok(created, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest(
        "A race condition occurred while assigning the supplier number. Please retry.",
      );
    }
    throw err;
  }
}
