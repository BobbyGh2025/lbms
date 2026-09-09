// ============================================================================
// LBMS Finance — Single Financial Account API
// GET    /api/finance/accounts/[id]   — fetch one account
// PATCH  /api/finance/accounts/[id]   — update (name, description, status, bankName, accountNumber)
// DELETE /api/finance/accounts/[id]   — soft-delete (blocks if has posted entries)
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, badRequest, forbidden, notFound, ok, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { getAccountBalance } from "@/lib/finance/reporting";

async function loadAccount(id: string) {
  return db.financialAccount.findFirst({
    where: { id, ...notDeleted() },
    select: {
      id: true, code: true, name: true, accountType: true, currency: true,
      openingBalance: true, status: true, description: true, bankName: true,
      accountNumber: true, createdAt: true, updatedAt: true,
      createdBy: { select: { username: true } },
    },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("finance", "view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const account = await loadAccount(id);
  if (!account) return notFound("Account not found.");

  const balance = await getAccountBalance(id);
  return ok({
    ...account,
    openingBalance: account.openingBalance.toString(),
    createdBy: account.createdBy?.username ?? null,
    balance: balance?.balance ?? "0.00",
    postedDebits: balance?.postedDebits ?? "0.00",
    postedCredits: balance?.postedCredits ?? "0.00",
    transactionCount: balance?.transactionCount ?? 0,
  });
}

const PatchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "Provide at least one field." });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("finance", "manage_accounts");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const existing = await loadAccount(id);
  if (!existing) return notFound("Account not found.");

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message, parsed.error.issues);
  const d = parsed.data;

  // Name uniqueness
  if (d.name && d.name !== existing.name) {
    const clash = await db.financialAccount.findFirst({
      where: { name: d.name, id: { not: id }, deletedAt: null },
      select: { id: true },
    });
    if (clash) return badRequest("An account with this name already exists.");
  }

  const updated = await db.financialAccount.update({
    where: { id },
    data: {
      ...(d.name ? { name: d.name } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.status ? { status: d.status } : {}),
      ...(d.bankName !== undefined ? { bankName: d.bankName } : {}),
      ...(d.accountNumber !== undefined ? { accountNumber: d.accountNumber } : {}),
    },
    select: { id: true, code: true, name: true, status: true },
  });

  await auditFromCtx(auth.ctx, {
    action: "update", module: "finance", recordId: id, recordType: "FinancialAccount",
    description: `Updated account ${existing.code} — ${existing.name}`,
    previousValue: { name: existing.name, status: existing.status },
    newValue: { name: updated.name, status: updated.status },
  });

  return ok(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize("finance", "manage_accounts");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const existing = await loadAccount(id);
  if (!existing) return notFound("Account not found.");

  // Block deletion if account has posted journal entries.
  const entryCount = await db.journalEntry.count({
    where: { financialAccountId: id, journal: { status: "posted" } },
  });
  if (entryCount > 0) {
    return forbidden(
      `Cannot delete account "${existing.name}" — it has ${entryCount} posted journal entries. Deactivate it instead.`,
    );
  }

  await db.financialAccount.update({
    where: { id },
    data: { deletedAt: new Date(), status: "inactive" },
  });

  await auditFromCtx(auth.ctx, {
    action: "delete", module: "finance", recordId: id, recordType: "FinancialAccount",
    description: `Deleted (soft) account ${existing.code} — ${existing.name}`,
  });

  return ok({ id, deleted: true });
}
