// ============================================================================
// LBMS Finance — Expenses API
// GET  /api/finance/expenses   — list expense transactions (filterable)
// POST /api/finance/expenses   — record expense (delegates to posting engine)
// ============================================================================

import { NextRequest } from "next/server";
import { z } from "zod";
import { authorize, badRequest, ok } from "@/lib/api-helpers";
import { postExpense } from "@/lib/finance/posting-engine";
import { MoneyError } from "@/lib/finance/money";
import { isPaymentMethod } from "@/lib/finance/constants";
import { db } from "@/lib/db";
import { checkIdempotency, cacheIdempotencyResponse } from "@/lib/finance/idempotency";

export async function GET(req: NextRequest) {
  const auth = await authorize("finance", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const departmentId = sp.get("departmentId");

  const where: any = { transactionType: "expense", status: { in: ["posted", "draft"] } };
  if (from || to) {
    where.transactionDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }
  if (departmentId && departmentId !== "all") where.departmentId = departmentId;

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

const CreateExpenseSchema = z.object({
  date: z.string(),
  amount: z.string().or(z.number()),
  financialAccountId: z.string(), // paying account
  ledgerAccountId: z.string(), // expense category
  description: z.string().optional(),
  notes: z.string().optional(),
  departmentId: z.string().optional(),
  partyRef: z.string().optional(), // supplier reference (future)
  projectRef: z.string().optional(),
  paymentMethod: z.string().optional(),
  externalRef: z.string().optional(),
  status: z.enum(["draft", "posted"]).default("posted"),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("finance", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON body."); }
  const parsed = CreateExpenseSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message, parsed.error.issues);
  const d = parsed.data;

  const idem = await checkIdempotency(req, auth.ctx.userId, body);
  if (idem.replay) return idem.response!;

  const [account, ledger] = await Promise.all([
    db.financialAccount.findFirst({
      where: { id: d.financialAccountId, deletedAt: null, status: "active" },
      select: { id: true, currency: true, name: true },
    }),
    db.ledgerAccount.findFirst({
      where: { id: d.ledgerAccountId, deletedAt: null, status: "active", accountClass: "expense" },
      select: { id: true, name: true },
    }),
  ]);
  if (!account) return badRequest("The selected financial account is invalid or inactive.");
  if (!ledger) return badRequest("The selected expense category is invalid or not an expense account.");

  if (d.paymentMethod && !isPaymentMethod(d.paymentMethod)) {
    return badRequest(`Invalid payment method: ${d.paymentMethod}.`);
  }

  let result;
  try {
    result = await postExpense({
      date: d.date,
      amount: d.amount,
      financialAccountId: d.financialAccountId,
      ledgerAccountId: d.ledgerAccountId,
      description: d.description,
      notes: d.notes,
      departmentId: d.departmentId,
      partyType: d.partyRef ? "supplier" : undefined,
      partyRef: d.partyRef,
      projectRef: d.projectRef,
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

  if (idem.key) {
    await cacheIdempotencyResponse(idem.key, 201, result);
  }

  return ok(result, 201);
}
