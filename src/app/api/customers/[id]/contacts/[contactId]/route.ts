// ============================================================================
// LBMS CRM API — Customer contact detail
// ----------------------------------------------------------------------------
// PATCH  /api/customers/[id]/contacts/[contactId]   update contact fields.
//                                                   customers:edit. Audit.
// DELETE /api/customers/[id]/contacts/[contactId]   soft-delete contact
//                                                   (status="inactive").
//                                                   customers:edit. Audit.
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
  params: Promise<{ id: string; contactId: string }>;
}

const PREFERRED_CONTACT_METHODS = ["email", "phone", "sms", "other"] as const;

// ---------------------------------------------------------------------------
// PATCH /api/customers/[id]/contacts/[contactId]
// ---------------------------------------------------------------------------
const UpdateCustomerContactSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100).optional(),
  lastName: z.string().max(100).nullable().optional(),
  jobTitle: z.string().max(200).nullable().optional(),
  email: z.string().email("Invalid email format").optional().or(z.literal("")).nullable(),
  phone: z.string().max(50).nullable().optional(),
  alternativePhone: z.string().max(50).nullable().optional(),
  preferredContactMethod: z.enum(PREFERRED_CONTACT_METHODS).nullable().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("customers", "edit");
  if (!auth.ok) return auth.response;

  const { id, contactId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = UpdateCustomerContactSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // Verify parent customer exists
  const customer = await db.customer.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, customerNumber: true },
  });
  if (!customer) return notFound("Customer not found.");

  const existing = await db.customerContact.findFirst({
    where: { id: contactId, customerId: id },
  });
  if (!existing) return notFound("Contact not found.");

  const data: Record<string, unknown> = {};

  if (d.firstName !== undefined) data.firstName = d.firstName.trim();
  if (d.lastName !== undefined) data.lastName = d.lastName?.trim() || null;
  if (d.jobTitle !== undefined) data.jobTitle = d.jobTitle?.trim() || null;
  if (d.phone !== undefined) data.phone = d.phone?.trim() || null;
  if (d.alternativePhone !== undefined)
    data.alternativePhone = d.alternativePhone?.trim() || null;
  if (d.notes !== undefined) data.notes = d.notes?.trim() || null;
  if (d.preferredContactMethod !== undefined)
    data.preferredContactMethod = d.preferredContactMethod;
  if (d.status !== undefined) data.status = d.status;

  if (d.email !== undefined) {
    const trimmed =
      typeof d.email === "string" ? d.email.trim().toLowerCase() : "";
    data.email = trimmed || null;
  }

  // If promoting to primary, unset other primaries for the same customer
  // inside a transaction so the "one primary per customer" invariant holds.
  const promotingPrimary = d.isPrimary === true && !existing.isPrimary;
  if (promotingPrimary) {
    if (Object.keys(data).length === 0) {
      // edge case: payload only flips isPrimary — still valid
    }
    data.isPrimary = true;
  } else if (d.isPrimary !== undefined) {
    data.isPrimary = d.isPrimary;
  }

  if (Object.keys(data).length === 0) {
    return badRequest("No fields provided to update.");
  }

  const updated = await db.$transaction(async (tx) => {
    if (promotingPrimary) {
      await tx.customerContact.updateMany({
        where: { customerId: id, isPrimary: true, NOT: { id: contactId } },
        data: { isPrimary: false },
      });
    }
    return tx.customerContact.update({
      where: { id: contactId },
      data,
    });
  });

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "customers",
    recordId: updated.id,
    recordType: "CustomerContact",
    description: `Updated contact "${updated.firstName}${
      updated.lastName ? ` ${updated.lastName}` : ""
    }" for customer ${customer.customerNumber}`,
    previousValue: existing,
    newValue: updated,
  });

  return ok(updated);
}

// ---------------------------------------------------------------------------
// DELETE /api/customers/[id]/contacts/[contactId]
// ---------------------------------------------------------------------------
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const auth = await authorize("customers", "edit");
  if (!auth.ok) return auth.response;

  const { id, contactId } = await params;

  const customer = await db.customer.findFirst({
    where: { id, ...notDeleted() },
    select: { id: true, customerNumber: true },
  });
  if (!customer) return notFound("Customer not found.");

  const existing = await db.customerContact.findFirst({
    where: { id: contactId, customerId: id },
  });
  if (!existing) return notFound("Contact not found.");

  // Soft-delete via status="inactive" (the schema has no deletedAt field
  // on CustomerContact; status is the soft-delete channel here).
  const updated = await db.customerContact.update({
    where: { id: contactId },
    data: { status: "inactive", isPrimary: false },
  });

  await auditFromCtx(auth.ctx, {
    action: "delete",
    module: "customers",
    recordId: updated.id,
    recordType: "CustomerContact",
    description: `Deleted contact "${existing.firstName}${
      existing.lastName ? ` ${existing.lastName}` : ""
    }" for customer ${customer.customerNumber}`,
    previousValue: existing,
    newValue: updated,
  });

  return ok({ id: updated.id, deleted: true, status: updated.status });
}
