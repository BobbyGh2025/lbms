// ============================================================================
// LBMS Finance — Financial Accounts API
// GET    /api/finance/accounts        — list accounts with derived balances
// POST   /api/finance/accounts        — create an account (+ opening balance)
// PATCH  /api/finance/accounts/[id]   — update account
// DELETE /api/finance/accounts/[id]   — soft-delete (blocks if has postings)
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, badRequest, forbidden, notFound, ok, pagination, auditFromCtx, notDeleted } from "@/lib/api-helpers";
import { listAccountBalances } from "@/lib/finance/reporting";
import { toMoney } from "@/lib/finance/money";

export async function GET(req: NextRequest) {
  const auth = await authorize("finance", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") || undefined;

  if (sp.get("withBalances") === "true") {
    const balances = await listAccountBalances();
    const filtered = status && status !== "all" ? balances.filter((b) => b.accountType === status) : balances;
    return ok({ items: filtered });
  }

  const { page, pageSize, search, skip } = pagination(sp);
  const where: any = { ...notDeleted() };
  if (status && status !== "all") where.status = status;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { code: { contains: search } },
    ];
  }
  const [total, items] = await Promise.all([
    db.financialAccount.count({ where }),
    db.financialAccount.findMany({
      where,
      orderBy: { code: "asc" },
      skip,
      take: pageSize,
      select: {
        id: true, code: true, name: true, accountType: true, currency: true,
        openingBalance: true, status: true, description: true, bankName: true,
        accountNumber: true, createdAt: true, updatedAt: true,
        createdBy: { select: { username: true } },
      },
    }),
  ]);
  return ok({
    items: items.map((a) => ({
      ...a,
      openingBalance: a.openingBalance.toString(),
      createdBy: a.createdBy?.username ?? null,
    })),
    total, page, pageSize,
  });
}

const CreateAccountSchema = z.object({
  code: z.string().min(2).max(20),
  name: z.string().min(2).max(100),
  accountType: z.enum(["asset", "liability"]).default("asset"),
  currency: z.string().length(3).default("GHS"),
  openingBalance: z.string().or(z.number()).default(0),
  description: z.string().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  postOpeningBalance: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("finance", "manage_accounts");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = CreateAccountSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid request.", parsed.error.issues);
  }
  const d = parsed.data;

  // Uniqueness check
  const existing = await db.financialAccount.findFirst({
    where: { OR: [{ code: d.code }, { name: d.name }], deletedAt: null },
    select: { id: true, code: true },
  });
  if (existing) return badRequest(`An account with code "${d.code}" or name "${d.name}" already exists.`);

  const opening = toMoney(d.openingBalance);
  if (opening.lt(0)) return badRequest("Opening balance cannot be negative.");

  // Create account + optionally post opening balance journal (atomic).
  const account = await db.$transaction(async (tx) => {
    const acc = await tx.financialAccount.create({
      data: {
        code: d.code, name: d.name, accountType: d.accountType, currency: d.currency,
        openingBalance: opening, status: "active", description: d.description ?? null,
        bankName: d.bankName ?? null, accountNumber: d.accountNumber ?? null,
        createdById: auth.ctx.userId,
      },
    });

    if (d.postOpeningBalance && opening.gt(0)) {
      // Post an OPENING_BALANCE journal: debit the account, credit owner's equity.
      const equityLedger = await tx.ledgerAccount.findFirst({
        where: { code: "EQT-OWNER" },
        select: { id: true },
      });
      const assetLedger = await tx.ledgerAccount.findFirst({
        where: { code: "AST-CASH" },
        select: { id: true },
      });
      const year = new Date().getFullYear();
      const counter = await tx.financeRefCounter.upsert({
        where: { prefix_year: { prefix: "OPB", year } },
        update: { nextNumber: { increment: 1 } },
        create: { prefix: "OPB", year, nextNumber: 2 },
      });
      const ref = `OPB-${year}-${String(counter.nextNumber - 1).padStart(6, "0")}`;
      const today = new Date();
      await tx.journal.create({
        data: {
          reference: ref,
          transactionType: "opening_balance",
          status: "posted",
          transactionDate: today,
          description: `Opening balance for ${acc.name}`,
          financialAccountId: acc.id,
          ledgerAccountId: equityLedger?.id ?? assetLedger?.id ?? null,
          amount: opening,
          currency: d.currency,
          createdById: auth.ctx.userId,
          postedAt: new Date(),
          entries: {
            create: [
              {
                financialAccountId: acc.id,
                ledgerAccountId: assetLedger?.id ?? null,
                debit: opening, credit: 0, currency: d.currency,
                description: `Opening balance — ${acc.name}`,
              },
              {
                // Equity credit — no financial account (not cash).
                ledgerAccountId: equityLedger?.id ?? null,
                debit: 0, credit: opening, currency: d.currency,
                description: `Opening equity — ${acc.name}`,
              },
            ],
          },
        },
      });
    }
    return acc;
  });

  await auditFromCtx(auth.ctx, {
    action: "create", module: "finance", recordId: account.id, recordType: "FinancialAccount",
    description: `Created financial account ${account.code} — ${account.name}`,
    newValue: { code: account.code, name: account.name, accountType: account.accountType, openingBalance: opening.toString() },
  });

  return ok({
    id: account.id, code: account.code, name: account.name, accountType: account.accountType,
    currency: account.currency, openingBalance: opening.toString(), status: account.status,
  }, 201);
}
