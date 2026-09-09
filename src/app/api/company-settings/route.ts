// ============================================================================
// LBMS — Company Settings API (singleton)
// ----------------------------------------------------------------------------
// GET  /api/company-settings      → return the singleton row (create-on-read
//                                   with defaults if missing)
// PUT  /api/company-settings      → partial update of the singleton
//
// Permissions:
//   GET requires `settings:view`
//   PUT requires `settings:edit`
// MD bypasses all permission checks.
// All PUT operations are audited with previousValue + newValue snapshots.
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, auditFromCtx, ok, badRequest } from "@/lib/api-helpers";

// ---------------------------------------------------------------------------
// Validation schema (Zod v4)
// ---------------------------------------------------------------------------
// `invoiceStart` must be >= 0; `currency` must be a non-empty 3-letter code;
// `email` (if provided) must be email-shaped. Empty strings are normalised
// to `null` for nullable string fields so the DB never stores "".
// ---------------------------------------------------------------------------

const currencySchema = z
  .string()
  .trim()
  .length(3, "Currency must be a 3-letter ISO code (e.g. GHS).")
  .regex(/^[A-Z]{3}$/, "Currency must be 3 uppercase letters (e.g. GHS).");

const emailSchema = z
  .string()
  .trim()
  .max(200)
  .email("A valid email address is required.")
  .or(z.literal(""))
  .transform((v) => (v === "" ? null : v));

// Helper: convert empty strings → null for optional / nullable fields.
const optionalNullableString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v))
    .optional();

const optionalNonEmptyString = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .optional();

export const updateCompanySettingsSchema = z.object({
  companyName: optionalNonEmptyString(200),
  legalName: optionalNullableString(200),
  logoUrl: optionalNullableString(2000),
  address: optionalNullableString(500),
  city: optionalNullableString(100),
  region: optionalNullableString(100),
  country: optionalNonEmptyString(100),
  phone: optionalNullableString(50),
  email: emailSchema.optional(),
  website: optionalNullableString(500),
  currency: currencySchema.optional(),
  currencySymbol: z
    .string()
    .trim()
    .min(1, "Currency symbol cannot be empty.")
    .max(20)
    .optional(),
  financialYearStart: optionalNullableString(10),
  invoicePrefix: optionalNonEmptyString(20),
  invoiceStart: z
    .number()
    .int("Invoice start must be a whole number.")
    .min(0, "Invoice start must be >= 0.")
    .optional(),
  taxIdNumber: optionalNullableString(100),
});

export type UpdateCompanySettingsInput = z.infer<typeof updateCompanySettingsSchema>;

// ---------------------------------------------------------------------------
// GET — return the singleton (create with defaults if missing)
// ---------------------------------------------------------------------------
export async function GET() {
  const auth = await authorize("settings", "view");
  if (!auth.ok) return auth.response;

  let settings = await db.companySetting.findUnique({
    where: { id: "singleton" },
  });

  if (!settings) {
    // Defensive: should already exist (seed.ts creates it), but fall back to
    // Prisma defaults so the UI never renders against a null row.
    settings = await db.companySetting.create({
      data: { id: "singleton" },
    });
  }

  return ok(settings);
}

// ---------------------------------------------------------------------------
// PUT — partial update of the singleton
// ---------------------------------------------------------------------------
export async function PUT(req: NextRequest) {
  const auth = await authorize("settings", "edit");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = updateCompanySettingsSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Validation failed.", parsed.error.flatten());
  }
  const data = parsed.data;

  // Capture the previous state for the audit trail. If the row is somehow
  // missing, treat the update as a create so the singleton always exists.
  const previous = await db.companySetting.findUnique({
    where: { id: "singleton" },
  });

  let updated: Awaited<ReturnType<typeof db.companySetting.upsert>>;

  if (!previous) {
    // Build create payload from defaults + provided fields.
    const createPayload: Record<string, unknown> = { id: "singleton" };
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) createPayload[k] = v;
    }
    updated = await db.companySetting.create({ data: createPayload as never });
  } else {
    // Only spread keys that were explicitly provided so unspecified fields
    // retain their existing values.
    const updatePayload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) updatePayload[k] = v;
    }
    updated = await db.companySetting.update({
      where: { id: "singleton" },
      data: updatePayload as never,
    });
  }

  await auditFromCtx(auth.ctx, {
    action: "update",
    module: "settings",
    recordId: "singleton",
    recordType: "CompanySetting",
    description: "Updated company settings",
    previousValue: previous,
    newValue: updated,
  });

  return ok(updated);
}
