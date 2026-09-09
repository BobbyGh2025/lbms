// ============================================================================
// LBMS Finance — Chart of Accounts (Ledger Categories) API
// GET    /api/finance/categories   — list categories (filter by class)
// POST   /api/finance/categories   — create a category
// PATCH  /api/finance/categories/[id]   — update
// DELETE /api/finance/categories/[id]   — soft-delete (blocks if has postings)
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authorize, badRequest, forbidden, notFound, ok, pagination, auditFromCtx, notDeleted,
} from "@/lib/api-helpers";
import { isAccountClass } from "@/lib/finance/constants";

export async function GET(req: NextRequest) {
  const auth = await authorize("finance", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const accountClass = sp.get("accountClass") || undefined;
  const accountType = sp.get("accountType") || undefined;
  const status = sp.get("status") || undefined;

  const where: any = { ...notDeleted() };
  if (accountClass && accountClass !== "all") where.accountClass = accountClass;
  if (accountType && accountType !== "all") where.accountType = accountType;
  if (status && status !== "all") where.status = status;

  const items = await db.ledgerAccount.findMany({
    where,
    orderBy: [{ accountClass: "asc" }, { code: "asc" }],
    select: {
      id: true, code: true, name: true, accountClass: true, accountType: true,
      currency: true, status: true, description: true, isSystem: true,
      createdAt: true, createdBy: { select: { username: true } },
      _count: { select: { journals: true } },
    },
  });

  return ok({
    items: items.map((c) => ({
      id: c.id, code: c.code, name: c.name, accountClass: c.accountClass,
      accountType: c.accountType, currency: c.currency, status: c.status,
      description: c.description, isSystem: c.isSystem,
      createdAt: c.createdAt.toISOString(),
      createdBy: c.createdBy?.username ?? null,
      usageCount: c._count.journals,
    })),
  });
}

const CreateCategorySchema = z.object({
  code: z.string().min(2).max(20),
  name: z.string().min(2).max(100),
  accountClass: z.string(),
  accountType: z.string().optional(),
  currency: z.string().length(3).default("GHS"),
  description: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("finance", "manage_categories");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = CreateCategorySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message, parsed.error.issues);
  const d = parsed.data;

  if (!isAccountClass(d.accountClass)) {
    return badRequest(`Invalid account class: ${d.accountClass}. Must be one of: asset, liability, equity, income, expense.`);
  }

  const existing = await db.ledgerAccount.findFirst({
    where: { OR: [{ code: d.code }, { name: d.name }], deletedAt: null },
    select: { id: true, code: true },
  });
  if (existing) return badRequest(`A category with code "${d.code}" or name "${d.name}" already exists.`);

  const created = await db.ledgerAccount.create({
    data: {
      code: d.code, name: d.name, accountClass: d.accountClass,
      accountType: d.accountType ?? d.accountClass, currency: d.currency,
      description: d.description ?? null, isSystem: false, createdById: auth.ctx.userId,
    },
    select: { id: true, code: true, name: true, accountClass: true },
  });

  await auditFromCtx(auth.ctx, {
    action: "create", module: "finance", recordId: created.id, recordType: "LedgerAccount",
    description: `Created ledger category ${created.code} — ${created.name} (${created.accountClass})`,
    newValue: created,
  });

  return ok(created, 201);
}
