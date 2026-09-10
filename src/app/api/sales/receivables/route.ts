// ============================================================================
// LBMS Phase 10 API — Receivables dashboard
// ----------------------------------------------------------------------------
// GET /api/sales/receivables
//   Receivables dashboard: total outstanding, overdue count, aging buckets
//   (0-30, 31-60, 61-90, 90+ days), and customer breakdown.
//   Aggregates only non-voided invoices with balance > 0. Each invoice's
//   `overdue` flag is DERIVED (dueDate < now AND balanceDue > 0 AND
//   status != voided). Aging uses (now − dueDate) for overdue invoices.
//   Requires `sales:view`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, notDeleted,
} from "@/lib/api-helpers";
import { isInvoiceOverdue } from "@/lib/sales-utils";
import { toMoney, serializeMoney, ZERO } from "@/lib/finance/money";

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  customerId: string;
  dueDate: Date;
  total: any;
  amountPaid: any;
  balanceDue: any;
  status: string;
}

interface CustomerRow {
  id: string;
  customerNumber: string;
  tradingName: string | null;
  legalName: string | null;
  firstName: string | null;
  lastName: string | null;
}

function customerDisplayName(c: CustomerRow | null): string {
  if (!c) return "Unknown";
  return c.tradingName || c.legalName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.customerNumber;
}

function dayBuckets(daysOverdue: number): "0-30" | "31-60" | "61-90" | "90+" {
  if (daysOverdue <= 30) return "0-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function GET(_req: NextRequest) {
  const auth = await authorize("sales", "view");
  if (!auth.ok) return auth.response;

  // Fetch all non-voided invoices with their customer.
  const invoices = await db.invoice.findMany({
    where: {
      ...notDeleted(),
      status: { not: "voided" },
    },
    select: {
      id: true, invoiceNumber: true, customerId: true,
      dueDate: true, total: true, amountPaid: true, balanceDue: true, status: true,
      customer: {
        select: {
          id: true, customerNumber: true, tradingName: true, legalName: true,
          firstName: true, lastName: true, status: true,
        },
      },
    },
  });

  // Fetch all posted payments (for the paid-in-period metric — optional).
  // Currently we only compute outstanding (current snapshot).
  const now = new Date();

  let totalOutstanding = ZERO;
  let totalOverdue = ZERO;
  let overdueCount = 0;
  let outstandingCount = 0;
  let invoiceCount = invoices.length;

  const aging = {
    "0-30": { count: 0, amount: ZERO },
    "31-60": { count: 0, amount: ZERO },
    "61-90": { count: 0, amount: ZERO },
    "90+": { count: 0, amount: ZERO },
  };

  const customerMap = new Map<string, {
    customer: CustomerRow;
    outstanding: typeof ZERO;
    overdue: typeof ZERO;
    invoiceCount: number;
    overdueCount: number;
    oldestDueDate: Date | null;
  }>();

  for (const inv of invoices) {
    const balance = toMoney(inv.balanceDue);
    if (balance.lte(0)) continue; // skip fully-paid invoices

    outstandingCount += 1;
    totalOutstanding = totalOutstanding.plus(balance);

    const overdue = isInvoiceOverdue({
      dueDate: inv.dueDate,
      balanceDue: inv.balanceDue,
      status: inv.status,
    });

    const customer = inv.customer as CustomerRow | null;
    if (!customerMap.has(inv.customerId)) {
      customerMap.set(inv.customerId, {
        customer: customer as CustomerRow,
        outstanding: ZERO,
        overdue: ZERO,
        invoiceCount: 0,
        overdueCount: 0,
        oldestDueDate: null,
      });
    }
    const c = customerMap.get(inv.customerId)!;
    c.outstanding = c.outstanding.plus(balance);
    c.invoiceCount += 1;
    if (!c.oldestDueDate || inv.dueDate < c.oldestDueDate) c.oldestDueDate = inv.dueDate;

    if (overdue) {
      overdueCount += 1;
      totalOverdue = totalOverdue.plus(balance);
      c.overdue = c.overdue.plus(balance);
      c.overdueCount += 1;

      const daysOverdue = Math.floor((now.getTime() - inv.dueDate.getTime()) / MS_PER_DAY);
      const bucket = dayBuckets(daysOverdue);
      aging[bucket].count += 1;
      aging[bucket].amount = aging[bucket].amount.plus(balance);
    }
  }

  // Build customer breakdown (sorted by outstanding desc), top 20.
  const customerBreakdown = Array.from(customerMap.values())
    .map((c) => ({
      customerId: c.customer.id,
      customerNumber: c.customer.customerNumber,
      name: customerDisplayName(c.customer),
      status: (c.customer as any).status,
      outstanding: serializeMoney(c.outstanding),
      overdue: serializeMoney(c.overdue),
      invoiceCount: c.invoiceCount,
      overdueCount: c.overdueCount,
      oldestDueDate: c.oldestDueDate?.toISOString() ?? null,
    }))
    .sort((a, b) => toMoney(b.outstanding).cmp(toMoney(a.outstanding)))
    .slice(0, 20);

  return ok({
    summary: {
      totalOutstanding: serializeMoney(totalOutstanding),
      totalOverdue: serializeMoney(totalOverdue),
      outstandingCount,
      overdueCount,
      invoiceCount,
    },
    aging: {
      "0-30": { count: aging["0-30"].count, amount: serializeMoney(aging["0-30"].amount) },
      "31-60": { count: aging["31-60"].count, amount: serializeMoney(aging["31-60"].amount) },
      "61-90": { count: aging["61-90"].count, amount: serializeMoney(aging["61-90"].amount) },
      "90+": { count: aging["90+"].count, amount: serializeMoney(aging["90+"].amount) },
    },
    customerBreakdown,
    generatedAt: now.toISOString(),
  });
}
