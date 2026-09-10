// ============================================================================
// LBMS Phase 11 API — Supplier Payment collection
// ----------------------------------------------------------------------------
// GET  /api/payables/payments   paginated, searchable, filterable list.
//   Search matches paymentNumber. Filters: status, supplierId, supplierBillId,
//   paymentMethod, financialAccountId. Requires `payables:view`.
// POST /api/payables/payments   create a draft payment (auto SP-YYYY-NNNNNN).
//   supplierId REQUIRED. Optional supplierBillId (if provided, bill must be
//   posted/partially_paid + same supplier + amount ≤ bill.balanceDue for
//   overpayment protection). financialAccountId REQUIRED (which cash/bank
//   account pays). Requires `payables:pay`.
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

// ---------------------------------------------------------------------------
// GET /api/payables/payments
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("payables", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const supplierId = sp.get("supplierId")?.trim() || undefined;
  const supplierBillId = sp.get("supplierBillId")?.trim() || undefined;
  const paymentMethod = sp.get("paymentMethod")?.trim() || undefined;
  const financialAccountId = sp.get("financialAccountId")?.trim() || undefined;

  const where: Record<string, unknown> = {
    ...(search ? { paymentNumber: { contains: search } } : {}),
    ...(status ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(supplierBillId ? { supplierBillId } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(financialAccountId ? { financialAccountId } : {}),
  };

  const [total, rawItems] = await Promise.all([
    db.supplierPayment.count({ where }),
    db.supplierPayment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        supplier: {
          select: {
            id: true, supplierNumber: true, tradingName: true, legalName: true, status: true,
          },
        },
        supplierBill: {
          select: { id: true, billNumber: true, status: true, total: true, balanceDue: true },
        },
        createdBy: { select: { id: true, username: true } },
        voidedBy: { select: { id: true, username: true } },
      },
    }),
  ]);

  // Enrich with FinancialAccount info (SupplierPayment has no Prisma relation — fetch manually).
  const finAccIds = Array.from(new Set(rawItems.map((p) => p.financialAccountId).filter(Boolean))) as string[];
  const finAccs = finAccIds.length
    ? await db.financialAccount.findMany({
        where: { id: { in: finAccIds } },
        select: { id: true, code: true, name: true, currency: true },
      })
    : [];
  const finAccMap = new Map(finAccs.map((f) => [f.id, f]));
  const items = rawItems.map((p) => ({
    ...p,
    financialAccount: p.financialAccountId ? finAccMap.get(p.financialAccountId) ?? null : null,
  }));

  return ok({
    items,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

// ---------------------------------------------------------------------------
// POST /api/payables/payments
// ---------------------------------------------------------------------------
const CreatePaymentSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  supplierBillId: z.string().optional(),
  financialAccountId: z.string().min(1, "Paying financial account is required"),
  paymentDate: dateString.optional(),
  amount: decimalString,
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("payables", "pay");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = CreatePaymentSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Validation failed", parsed.error.issues);
  }
  const d = parsed.data;

  // --- Validate supplier ---
  const supplier = await db.supplier.findFirst({
    where: { id: d.supplierId, ...notDeleted() },
    select: { id: true, supplierNumber: true, tradingName: true, legalName: true, status: true },
  });
  if (!supplier) return badRequest("Selected supplier does not exist or is archived.");
  if (supplier.status === "archived" || supplier.status === "suspended") {
    return badRequest(`Cannot create a payment for a ${supplier.status} supplier.`);
  }

  // --- Validate financialAccountId ---
  const finAcc = await db.financialAccount.findFirst({
    where: { id: d.financialAccountId, deletedAt: null, status: "active" },
    select: { id: true, code: true, name: true, currency: true },
  });
  if (!finAcc) {
    return badRequest("Selected financial account does not exist or is inactive.");
  }

  // --- Validate amount > 0 ---
  const amount = toMoney(d.amount);
  if (amount.lte(0)) {
    return badRequest("Payment amount must be greater than zero.");
  }

  // --- Validate supplierBillId (if provided) ---
  let bill: { id: string; billNumber: string; status: string; balanceDue: any; supplierId: string; total: any } | null = null;
  if (d.supplierBillId) {
    bill = await db.supplierBill.findFirst({
      where: { id: d.supplierBillId, ...notDeleted() },
      select: { id: true, billNumber: true, status: true, balanceDue: true, supplierId: true, total: true },
    });
    if (!bill) return badRequest("Selected bill does not exist or is archived.");
    if (!["posted", "partially_paid"].includes(bill.status)) {
      return badRequest(`Cannot record a payment against a ${bill.status} bill. Only posted or partially paid bills accept payments.`);
    }
    if (bill.supplierId !== d.supplierId) {
      return badRequest("Bill/supplier mismatch: the selected bill belongs to a different supplier.");
    }

    // Overpayment protection: amount ≤ bill.balanceDue.
    const bal = toMoney(bill.balanceDue);
    if (amount.gt(bal)) {
      return badRequest(
        `Overpayment rejected: payment amount (${serializeMoney(amount)}) exceeds bill balance due (${serializeMoney(bal)}).`,
      );
    }
  }

  const year = new Date().getFullYear();

  try {
    const created = await db.$transaction(async (tx) => {
      const paymentNumber = await nextPayableRefNumber(tx, "SP", year);
      return tx.supplierPayment.create({
        data: {
          paymentNumber,
          supplierId: d.supplierId,
          supplierBillId: d.supplierBillId || null,
          financialAccountId: d.financialAccountId,
          paymentDate: d.paymentDate ? new Date(d.paymentDate) : new Date(),
          amount: serializeMoney(amount),
          paymentMethod: d.paymentMethod ?? "bank_transfer",
          reference: d.reference?.trim() || null,
          notes: d.notes?.trim() || null,
          status: "draft",
          createdById: auth.ctx.userId,
        },
        include: {
          supplier: {
            select: { id: true, supplierNumber: true, tradingName: true, legalName: true },
          },
          supplierBill: {
            select: { id: true, billNumber: true, status: true, balanceDue: true },
          },
        },
      });
    });

    // Enrich with financialAccount info (no Prisma relation on SupplierPayment).
    const enriched = { ...created, financialAccount: finAcc };

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "payables",
      recordId: enriched.id,
      recordType: "SupplierPayment",
      description: `Created supplier payment ${enriched.paymentNumber} for supplier ${supplier.supplierNumber} (${serializeMoney(amount)})`,
      newValue: {
        paymentNumber: enriched.paymentNumber,
        supplierId: enriched.supplierId,
        supplierBillId: enriched.supplierBillId,
        financialAccountId: enriched.financialAccountId,
        amount: enriched.amount,
        status: enriched.status,
      },
    });

    return ok(enriched, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A race condition occurred while assigning the payment number. Please retry.");
    }
    throw err;
  }
}
