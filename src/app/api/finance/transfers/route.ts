// ============================================================================
// LBMS Finance — Transfers API
// GET  /api/finance/transfers   — list transfers
// POST /api/finance/transfers   — record transfer between accounts
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, badRequest, ok } from "@/lib/api-helpers";
import { postTransfer } from "@/lib/finance/posting-engine";
import { MoneyError } from "@/lib/finance/money";
import { checkIdempotency, cacheIdempotencyResponse } from "@/lib/finance/idempotency";

export async function GET(req: NextRequest) {
  const auth = await authorize("finance", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const where: any = { transactionType: "transfer", status: "posted" };
  if (from || to) {
    where.transactionDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const items = await db.journal.findMany({
    where,
    orderBy: { transactionDate: "desc" },
    take: 100,
    select: {
      id: true, reference: true, transactionDate: true, amount: true, currency: true,
      description: true, externalRef: true,
      financialAccount: { select: { id: true, name: true, code: true } },
      entries: {
        select: {
          debit: true, credit: true,
          financialAccount: { select: { id: true, name: true, code: true } },
        },
      },
    },
  });

  return ok({
    items: items.map((i) => ({
      id: i.id,
      reference: i.reference,
      transactionDate: i.transactionDate.toISOString(),
      amount: i.amount.toString(),
      currency: i.currency,
      description: i.description,
      externalRef: i.externalRef,
      fromAccount: i.entries.find((e) => e.credit.gt(0))?.financialAccount ?? null,
      toAccount: i.entries.find((e) => e.debit.gt(0))?.financialAccount ?? null,
    })),
  });
}

const CreateTransferSchema = z.object({
  date: z.string(),
  amount: z.string().or(z.number()),
  fromAccountId: z.string(),
  toAccountId: z.string(),
  description: z.string().optional(),
  notes: z.string().optional(),
  externalRef: z.string().optional(),
  status: z.enum(["draft", "posted"]).default("posted"),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("finance", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = CreateTransferSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message, parsed.error.issues);
  const d = parsed.data;

  const idem = await checkIdempotency(req, auth.ctx.userId, body);
  if (idem.replay) return idem.response!;

  if (d.fromAccountId === d.toAccountId) {
    return badRequest("Cannot transfer to the same account.");
  }

  const [fromAcc, toAcc] = await Promise.all([
    db.financialAccount.findFirst({
      where: { id: d.fromAccountId, deletedAt: null, status: "active" },
      select: { id: true, currency: true },
    }),
    db.financialAccount.findFirst({
      where: { id: d.toAccountId, deletedAt: null, status: "active" },
      select: { id: true, currency: true },
    }),
  ]);
  if (!fromAcc) return badRequest("The source account is invalid or inactive.");
  if (!toAcc) return badRequest("The destination account is invalid or inactive.");
  if (fromAcc.currency !== toAcc.currency) {
    return badRequest("Cross-currency transfers are not supported in Phase 2.");
  }

  let result;
  try {
    result = await postTransfer({
      date: d.date,
      amount: d.amount,
      fromAccountId: d.fromAccountId,
      toAccountId: d.toAccountId,
      description: d.description,
      notes: d.notes,
      externalRef: d.externalRef,
      createdById: auth.ctx.userId,
      status: d.status,
    });
  } catch (err) {
    const errorResponse = err instanceof MoneyError || (err instanceof Error && err.name === "FinanceValidationError")
      ? badRequest(err.message)
      : null;
    if (errorResponse && idem.key) {
      await cacheIdempotencyResponse(idem.key, 400, { error: (err as Error).message });
    }
    if (errorResponse) return errorResponse;
    throw err;
  }

  if (idem.key) {
    await cacheIdempotencyResponse(idem.key, 201, result);
  }

  return ok(result, 201);
}
