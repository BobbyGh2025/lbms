// ============================================================================
// LBMS Phase 11 API — Expense collection
// ----------------------------------------------------------------------------
// GET  /api/expenses   paginated, searchable, filterable list.
//   Search matches expenseNumber. Filters: status, supplierId, employeeId,
//   projectId, ledgerAccountCode, financialAccountId. Requires `expenses:view`.
// POST /api/expenses   create a draft expense (auto EXP-YYYY-NNNNNN).
//   amount > 0 REQUIRED. financialAccountId REQUIRED (which cash/bank account
//   pays — direct payment, no AP). Optional supplierId, employeeId, projectId,
//   ledgerAccountCode (defaults to "EXP-OTHER" at posting time), description,
//   paymentMethod, reference, notes. Requires `expenses:create`.
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
import { nextPayableRefNumber } from "@/lib/ap-utils";
import { toMoney, serializeMoney } from "@/lib/finance/money";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, "Must be a positive decimal string");

const PAYMENT_METHODS = ["cash", "bank_transfer", "mobile_money", "card", "cheque", "other"] as const;

const PROJECT_TERMINAL = new Set(["completed", "cancelled"]);

// ---------------------------------------------------------------------------
// GET /api/expenses
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("expenses", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const supplierId = sp.get("supplierId")?.trim() || undefined;
  const employeeId = sp.get("employeeId")?.trim() || undefined;
  const projectId = sp.get("projectId")?.trim() || undefined;
  const ledgerAccountCode = sp.get("ledgerAccountCode")?.trim() || undefined;
  const financialAccountId = sp.get("financialAccountId")?.trim() || undefined;

  const where: Record<string, unknown> = {
    ...(search ? { expenseNumber: { contains: search } } : {}),
    ...(status ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(employeeId ? { employeeId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(ledgerAccountCode ? { ledgerAccountCode } : {}),
    ...(financialAccountId ? { financialAccountId } : {}),
  };

  const [total, rawItems] = await Promise.all([
    db.expense.count({ where }),
    db.expense.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        supplier: {
          select: { id: true, supplierNumber: true, tradingName: true, legalName: true, status: true },
        },
        employee: {
          select: { id: true, employeeNumber: true, firstName: true, lastName: true },
        },
        project: {
          select: { id: true, projectNumber: true, name: true, status: true },
        },
        createdBy: { select: { id: true, username: true } },
        approvedBy: { select: { id: true, username: true } },
      },
    }),
  ]);

  // Enrich with FinancialAccount info (Expense has no Prisma relation — fetch manually).
  const finAccIds = Array.from(new Set(rawItems.map((e) => e.financialAccountId).filter(Boolean))) as string[];
  const finAccs = finAccIds.length
    ? await db.financialAccount.findMany({
        where: { id: { in: finAccIds } },
        select: { id: true, code: true, name: true, currency: true },
      })
    : [];
  const finAccMap = new Map(finAccs.map((f) => [f.id, f]));
  const items = rawItems.map((e) => ({
    ...e,
    financialAccount: e.financialAccountId ? finAccMap.get(e.financialAccountId) ?? null : null,
  }));

  return ok({
    items,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

// ---------------------------------------------------------------------------
// POST /api/expenses
// ---------------------------------------------------------------------------
const CreateExpenseSchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  amount: decimalString,
  financialAccountId: z.string().min(1, "Paying financial account is required"),
  ledgerAccountCode: z.string().max(50).optional(),
  supplierId: z.string().optional(),
  employeeId: z.string().optional(),
  projectId: z.string().optional(),
  expenseDate: dateString.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("expenses", "create");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreateExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // --- Validate amount > 0 ---
  const amount = toMoney(d.amount);
  if (amount.lte(0)) {
    return badRequest("Expense amount must be greater than zero.");
  }

  // --- Validate financialAccountId ---
  const finAcc = await db.financialAccount.findFirst({
    where: { id: d.financialAccountId, deletedAt: null, status: "active" },
    select: { id: true, code: true, name: true, currency: true },
  });
  if (!finAcc) {
    return badRequest("Selected financial account does not exist or is inactive.");
  }

  // --- Validate supplierId ---
  let supplier: { id: string; supplierNumber: string } | null = null;
  if (d.supplierId) {
    supplier = await db.supplier.findFirst({
      where: { id: d.supplierId, ...notDeleted() },
      select: { id: true, supplierNumber: true, status: true },
    });
    if (!supplier) return badRequest("Selected supplier does not exist or is archived.");
  }

  // --- Validate employeeId ---
  if (d.employeeId) {
    const emp = await db.employee.findFirst({
      where: { id: d.employeeId, deletedAt: null },
      select: { id: true, employeeNumber: true, status: true },
    });
    if (!emp) return badRequest("Selected employee does not exist or is archived.");
  }

  // --- Validate projectId ---
  if (d.projectId) {
    const project = await db.project.findFirst({
      where: { id: d.projectId, ...notDeleted() },
      select: { id: true, projectNumber: true, name: true, status: true },
    });
    if (!project) return badRequest("Selected project does not exist or is archived.");
    if (PROJECT_TERMINAL.has(project.status)) {
      return badRequest(`Cannot create an expense against a ${project.status} project.`);
    }
  }

  // --- Validate ledgerAccountCode (if provided, must exist) ---
  if (d.ledgerAccountCode) {
    const ledger = await db.ledgerAccount.findFirst({
      where: { code: d.ledgerAccountCode.trim(), deletedAt: null },
      select: { id: true, code: true, accountClass: true },
    });
    if (!ledger) {
      return badRequest(`Expense category "${d.ledgerAccountCode}" does not exist in the chart of accounts.`);
    }
    if (ledger.accountClass !== "expense") {
      return badRequest(`Ledger account "${d.ledgerAccountCode}" is not an expense account (class: ${ledger.accountClass}).`);
    }
  }

  const year = new Date().getFullYear();

  try {
    const created = await db.$transaction(async (tx) => {
      const expenseNumber = await nextPayableRefNumber(tx, "EXP", year);
      return tx.expense.create({
        data: {
          expenseNumber,
          ledgerAccountCode: d.ledgerAccountCode?.trim() || "EXP-OTHER",
          supplierId: d.supplierId || null,
          employeeId: d.employeeId || null,
          projectId: d.projectId || null,
          financialAccountId: d.financialAccountId,
          expenseDate: d.expenseDate ? new Date(d.expenseDate) : new Date(),
          amount: serializeMoney(amount),
          description: d.description.trim(),
          paymentMethod: d.paymentMethod ?? "cash",
          reference: d.reference?.trim() || null,
          notes: d.notes?.trim() || null,
          status: "draft",
          createdById: auth.ctx.userId,
        },
        include: {
          supplier: { select: { id: true, supplierNumber: true, tradingName: true } },
        },
      });
    });

    // Enrich with financialAccount info (no Prisma relation on Expense).
    const enriched = { ...created, financialAccount: finAcc };

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "expenses",
      recordId: enriched.id,
      recordType: "Expense",
      description: `Created expense ${enriched.expenseNumber} (${serializeMoney(amount)})${supplier ? ` for supplier ${supplier.supplierNumber}` : ""}`,
      newValue: {
        expenseNumber: enriched.expenseNumber,
        amount: enriched.amount,
        ledgerAccountCode: enriched.ledgerAccountCode,
        financialAccountId: enriched.financialAccountId,
        status: enriched.status,
      },
    });

    return ok(enriched, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A race condition occurred while assigning the expense number. Please retry.");
    }
    throw err;
  }
}
