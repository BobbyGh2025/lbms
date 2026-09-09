// ============================================================================
// LBMS CRM API — Supplier contacts collection
// ----------------------------------------------------------------------------
// GET  /api/suppliers/[id]/contacts   list contacts for a supplier, ordered
//                                     by isPrimary desc then createdAt desc.
//                                     suppliers:view.
// POST /api/suppliers/[id]/contacts   create a contact. When isPrimary=true,
//                                     unset other primaries for the same
//                                     supplier inside the same transaction.
//                                     suppliers:edit. Audit recorded.
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

interface RouteParams {
  params: Promise<{ id: string }>;
}

const PREFERRED_CONTACT_METHODS = ["email", "phone", "sms", "other"] as const;

// ---------------------------------------------------------------------------
// GET /api/suppliers/[id]/contacts
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("suppliers", "view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const supplier = await db.supplier.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, supplierNumber: true, tradingName: true, legalName: true },
  });
  if (!supplier) return notFound("Supplier not found.");

  const contacts = await db.supplierContact.findMany({
    where: { supplierId: id, status: "active" },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
  });

  return ok({ supplier, items: contacts });
}

// ---------------------------------------------------------------------------
// POST /api/suppliers/[id]/contacts
// ---------------------------------------------------------------------------
const CreateSupplierContactSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().max(100).optional(),
  jobTitle: z.string().max(200).optional(),
  email: z.string().email("Invalid email format").optional().or(z.literal("")),
  phone: z.string().max(50).optional(),
  alternativePhone: z.string().max(50).optional(),
  preferredContactMethod: z.enum(PREFERRED_CONTACT_METHODS).optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("suppliers", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateSupplierContactSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  const supplier = await db.supplier.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, supplierNumber: true, tradingName: true, legalName: true },
  });
  if (!supplier) return notFound("Supplier not found.");

  const email =
    d.email && d.email.trim() ? d.email.trim().toLowerCase() : null;

  const isPrimary = d.isPrimary ?? false;

  try {
    const created = await db.$transaction(async (tx) => {
      // If this contact is marked primary, unset other primaries for the
      // same supplier to maintain the "one primary per supplier" invariant.
      if (isPrimary) {
        await tx.supplierContact.updateMany({
          where: { supplierId: id, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      return tx.supplierContact.create({
        data: {
          supplierId: id,
          firstName: d.firstName.trim(),
          lastName: d.lastName?.trim() || null,
          jobTitle: d.jobTitle?.trim() || null,
          email,
          phone: d.phone?.trim() || null,
          alternativePhone: d.alternativePhone?.trim() || null,
          preferredContactMethod: d.preferredContactMethod ?? null,
          isPrimary,
          notes: d.notes?.trim() || null,
          status: "active",
        },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "suppliers",
      recordId: created.id,
      recordType: "SupplierContact",
      description: `Added contact "${created.firstName}${
        created.lastName ? ` ${created.lastName}` : ""
      }" to supplier ${supplier.supplierNumber}${
        isPrimary ? " (marked primary)" : ""
      }`,
      newValue: created,
    });

    return ok(created, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A contact with these details already exists for this supplier.");
    }
    throw err;
  }
}
