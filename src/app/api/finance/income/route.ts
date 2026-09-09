// ============================================================================
// LBMS Finance — Income API
// GET  /api/finance/income   — list income transactions (filterable)
// POST /api/finance/income   — record income (delegates to posting engine)
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { authorize, badRequest, ok, auditFromCtx } from "@/lib/api-helpers";
import { postIncome } from "@/lib/finance/posting-engine";
import { toMoney, toPositiveMoney, MoneyError } from "@/lib/finance/money";
import { isPaymentMethod } from "@/lib/finance/constants";
import { db } from "@/lib/db";
import { checkIdempotency, cacheIdempotencyResponse } from "@/lib/finance/idempotency";

export async function GET(req: NextRequest) {
  const auth = await authorize("finance", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");

  const where: any = { transactionType: "income", status: { in: ["posted", "draft"] } };
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
      description: true, status: true, paymentMethod: true, externalRef: true,
      financialAccount: { select: { id: true, name: true, code: true } },
      ledgerAccount: { select: { id: true, name: true, code: true } },
      department: { select: { id: true, name: true } },
      createdBy: { select: { username: true } },
    },
  });

  return ok({
    items: items.map((i) => ({
      ...i,
      amount: i.amount.toString(),
      transactionDate: i.transactionDate.toISOString(),
      financialAccount: i.financialAccount
        ? { id: i.financialAccount.id, name: i.financialAccount.name, code: i.financialAccount.code }
        : null,
      ledgerAccount: i.ledgerAccount
        ? { id: i.ledgerAccount.id, name: i.ledgerAccount.name, code: i.ledgerAccount.code }
        : null,
      department: i.department ? { id: i.department.id, name: i.department.name } : null,
      createdBy: i.createdBy?.username ?? null,
    })),
  });
}

const CreateIncomeSchema = z.object({
  date: z.string(),
  amount: z.string().or(z.number()),
  financialAccountId: z.string(),
  ledgerAccountId: z.string(),
  description: z.string().optional(),
  notes: z.string().optional(),
  departmentId: z.string().optional(),
  customerId: z.string().optional(), // Phase 4 FK to Customer
  partyRef: z.string().optional(), // legacy string reference
  projectId: z.string().optional(), // Phase 5 FK to Project
  projectRef: z.string().optional(), // legacy string reference
  paymentMethod: z.string().optional(),
  externalRef: z.string().optional(),
  status: z.enum(["draft", "posted"]).default("posted"),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("finance", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = CreateIncomeSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message, parsed.error.issues);
  const d = parsed.data;

  // Idempotency: if the client sent an Idempotency-Key header, check for a
  // cached response or claim the key before executing.
  const idem = await checkIdempotency(req, auth.ctx.userId, body);
  if (idem.replay) return idem.response!;

  // Validate referenced entities exist + active.
  const [account, ledger] = await Promise.all([
    db.financialAccount.findFirst({
      where: { id: d.financialAccountId, deletedAt: null, status: "active" },
      select: { id: true, currency: true, name: true },
    }),
    db.ledgerAccount.findFirst({
      where: { id: d.ledgerAccountId, deletedAt: null, status: "active", accountClass: "income" },
      select: { id: true, name: true },
    }),
  ]);
  if (!account) return badRequest("The selected financial account is invalid or inactive.");
  if (!ledger) return badRequest("The selected income category is invalid or not an income account.");

  if (d.paymentMethod && !isPaymentMethod(d.paymentMethod)) {
    return badRequest(`Invalid payment method: ${d.paymentMethod}.`);
  }

  let result;
  try {
    result = await postIncome({
      date: d.date,
      amount: d.amount,
      financialAccountId: d.financialAccountId,
      ledgerAccountId: d.ledgerAccountId,
      description: d.description,
      notes: d.notes,
      departmentId: d.departmentId,
      partyType: (d.customerId || d.partyRef) ? "customer" : undefined,
      partyRef: d.partyRef,
      customerId: d.customerId,
      projectRef: d.projectRef,
      projectId: d.projectId,
      paymentMethod: d.paymentMethod as any,
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

  // Cache the successful response for idempotency replays.
  if (idem.key) {
    await cacheIdempotencyResponse(idem.key, 201, result);
  }

  return ok(result, 201);
}
