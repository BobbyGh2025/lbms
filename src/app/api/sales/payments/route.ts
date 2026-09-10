// ============================================================================
// LBMS Phase 10 API — Customer Payment collection
// ----------------------------------------------------------------------------
// GET  /api/sales/payments   paginated, searchable, filterable list.
//   Search matches paymentNumber. Filters: status, customerId, invoiceId,
//   paymentMethod. Requires `sales:view`.
// POST /api/sales/payments   create a draft payment (auto PMT-YYYY-NNNNNN).
//   Optional invoiceId (if provided, must be issued/partially_paid/paid +
//   same customer + amount ≤ invoice.balanceDue for overpayment protection).
//   customerId REQUIRED. Validates customer exists + not archived.
//   Requires `sales:pay`.
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
import { nextSalesRefNumber } from "@/lib/sales-utils";
import { toMoney, serializeMoney } from "@/lib/finance/money";

const dateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date format" });

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, "Must be a positive decimal string");

const PAYMENT_METHODS = ["cash", "bank_transfer", "mobile_money", "card", "cheque", "other"] as const;

// ---------------------------------------------------------------------------
// GET /api/sales/payments
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await authorize("sales", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? "20") || 20));
  const skip = (page - 1) * pageSize;

  const search = sp.get("search")?.trim() || undefined;
  const status = sp.get("status")?.trim() || undefined;
  const customerId = sp.get("customerId")?.trim() || undefined;
  const invoiceId = sp.get("invoiceId")?.trim() || undefined;
  const paymentMethod = sp.get("paymentMethod")?.trim() || undefined;

  const where: Record<string, unknown> = {
    ...(search ? { paymentNumber: { contains: search } } : {}),
    ...(status ? { status } : {}),
    ...(customerId ? { customerId } : {}),
    ...(invoiceId ? { invoiceId } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
  };

  const [total, items] = await Promise.all([
    db.customerPayment.count({ where }),
    db.customerPayment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        customer: {
          select: {
            id: true, customerNumber: true, tradingName: true,
            legalName: true, firstName: true, lastName: true, status: true,
          },
        },
        invoice: {
          select: { id: true, invoiceNumber: true, status: true, total: true, balanceDue: true },
        },
        createdBy: { select: { id: true, username: true } },
        voidedBy: { select: { id: true, username: true } },
      },
    }),
  ]);

  return ok({
    items,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

// ---------------------------------------------------------------------------
// POST /api/sales/payments
// ---------------------------------------------------------------------------
const CreatePaymentSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  invoiceId: z.string().optional(),
  paymentDate: dateString.optional(),
  amount: decimalString,
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authorize("sales", "pay");
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

  // --- Validate customerId ---
  const customer = await db.customer.findFirst({
    where: { id: d.customerId, ...notDeleted() },
    select: { id: true, customerNumber: true, tradingName: true, legalName: true, status: true },
  });
  if (!customer) return badRequest("Selected customer does not exist or is archived.");
  if (customer.status === "archived" || customer.status === "suspended") {
    return badRequest(`Cannot create a payment for a ${customer.status} customer.`);
  }

  // --- Validate amount > 0 ---
  const amount = toMoney(d.amount);
  if (amount.lte(0)) {
    return badRequest("Payment amount must be greater than zero.");
  }

  // --- Validate invoiceId (if provided) ---
  let invoice: { id: string; invoiceNumber: string; status: string; balanceDue: any; customerId: string } | null = null;
  if (d.invoiceId) {
    invoice = await db.invoice.findFirst({
      where: { id: d.invoiceId, ...notDeleted() },
      select: { id: true, invoiceNumber: true, status: true, balanceDue: true, customerId: true },
    });
    if (!invoice) return badRequest("Selected invoice does not exist or is archived.");
    if (!["issued", "partially_paid", "paid"].includes(invoice.status)) {
      return badRequest(`Cannot record a payment against a ${invoice.status} invoice.`);
    }
    if (invoice.customerId !== d.customerId) {
      return badRequest("Invoice/customer mismatch: the selected invoice belongs to a different customer.");
    }

    // Overpayment protection: amount ≤ invoice.balanceDue.
    const bal = toMoney(invoice.balanceDue);
    if (amount.gt(bal)) {
      return badRequest(
        `Overpayment rejected: payment amount (${serializeMoney(amount)}) exceeds invoice balance due (${serializeMoney(bal)}).`,
      );
    }
  }

  const year = new Date().getFullYear();

  try {
    const created = await db.$transaction(async (tx) => {
      const paymentNumber = await nextSalesRefNumber(tx, "PMT", year);
      return tx.customerPayment.create({
        data: {
          paymentNumber,
          customerId: d.customerId,
          invoiceId: d.invoiceId || null,
          paymentDate: d.paymentDate ? new Date(d.paymentDate) : new Date(),
          amount: serializeMoney(amount),
          paymentMethod: d.paymentMethod ?? "cash",
          reference: d.reference?.trim() || null,
          notes: d.notes?.trim() || null,
          status: "draft",
          createdById: auth.ctx.userId,
        },
        include: {
          customer: {
            select: { id: true, customerNumber: true, tradingName: true, legalName: true },
          },
          invoice: {
            select: { id: true, invoiceNumber: true, status: true, balanceDue: true },
          },
        },
      });
    });

    await auditFromCtx(auth.ctx, {
      action: "create",
      module: "sales",
      recordId: created.id,
      recordType: "CustomerPayment",
      description: `Created payment ${created.paymentNumber} for customer ${customer.customerNumber} (${serializeMoney(amount)})`,
      newValue: {
        paymentNumber: created.paymentNumber,
        customerId: created.customerId,
        invoiceId: created.invoiceId,
        amount: created.amount,
        status: created.status,
      },
    });

    return ok(created, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return badRequest("A race condition occurred while assigning the payment number. Please retry.");
    }
    throw err;
  }
}
