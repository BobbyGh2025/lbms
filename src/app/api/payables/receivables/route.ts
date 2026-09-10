// ============================================================================
// LBMS Phase 11 API — Accounts Payable dashboard
// ----------------------------------------------------------------------------
// GET /api/payables/receivables
//   AP dashboard: total AP outstanding, overdue count + amount, aging buckets
//   (0-30, 31-60, 61-90, 90+ days), and supplier breakdown.
//
//   Aggregates only non-voided supplier bills with balanceDue > 0. Each bill's
//   `overdue` flag is DERIVED (dueDate < now AND balanceDue > 0 AND status !=
//   voided). Aging uses (now − dueDate) for overdue bills.
//
//   Also includes posted-but-unpaid expense breakdown? No — expenses are
//   direct payments (no AP). Only bills contribute to AP.
//
//   Requires `payables:view`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize, ok, notDeleted,
} from "@/lib/api-helpers";
import { isBillOverdue } from "@/lib/ap-utils";
import { toMoney, serializeMoney, ZERO } from "@/lib/finance/money";

interface BillRow {
  id: string;
  billNumber: string;
  supplierId: string;
  dueDate: Date | null;
  total: any;
  amountPaid: any;
  balanceDue: any;
  status: string;
}

interface SupplierRow {
  id: string;
  supplierNumber: string;
  tradingName: string | null;
  legalName: string | null;
  status: string;
}

function supplierDisplayName(s: SupplierRow | null): string {
  if (!s) return "Unknown";
  return s.tradingName || s.legalName || s.supplierNumber;
}

function dayBuckets(daysOverdue: number): "0-30" | "31-60" | "61-90" | "90+" {
  if (daysOverdue <= 30) return "0-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function GET(_req: NextRequest) {
  const auth = await authorize("payables", "view");
  if (!auth.ok) return auth.response;

  // Fetch all non-voided bills (only bills contribute to AP — expenses are
  // direct payments, no AP intermediate).
  const bills = await db.supplierBill.findMany({
    where: {
      ...notDeleted(),
      status: { not: "voided" },
    },
    select: {
      id: true, billNumber: true, supplierId: true,
      dueDate: true, total: true, amountPaid: true, balanceDue: true, status: true,
      supplier: {
        select: {
          id: true, supplierNumber: true, tradingName: true, legalName: true, status: true,
        },
      },
    },
  });

  const now = new Date();

  let totalPayable = ZERO;
  let totalOverdue = ZERO;
  let overdueCount = 0;
  let outstandingCount = 0;
  let billCount = bills.length;

  const aging = {
    "0-30": { count: 0, amount: ZERO },
    "31-60": { count: 0, amount: ZERO },
    "61-90": { count: 0, amount: ZERO },
    "90+": { count: 0, amount: ZERO },
  };

  const supplierMap = new Map<string, {
    supplier: SupplierRow;
    outstanding: typeof ZERO;
    overdue: typeof ZERO;
    billCount: number;
    overdueCount: number;
    oldestDueDate: Date | null;
  }>();

  for (const bill of bills) {
    const balance = toMoney(bill.balanceDue);
    if (balance.lte(0)) continue; // skip fully-paid bills

    outstandingCount += 1;
    totalPayable = totalPayable.plus(balance);

    const overdue = isBillOverdue({
      dueDate: bill.dueDate,
      balanceDue: bill.balanceDue,
      status: bill.status,
    });

    const supplier = (bill.supplier as SupplierRow | null) ?? null;
    if (!supplierMap.has(bill.supplierId)) {
      supplierMap.set(bill.supplierId, {
        supplier: supplier as SupplierRow,
        outstanding: ZERO,
        overdue: ZERO,
        billCount: 0,
        overdueCount: 0,
        oldestDueDate: null,
      });
    }
    const s = supplierMap.get(bill.supplierId)!;
    s.outstanding = s.outstanding.plus(balance);
    s.billCount += 1;
    if (bill.dueDate && (!s.oldestDueDate || bill.dueDate < s.oldestDueDate)) {
      s.oldestDueDate = bill.dueDate;
    }

    if (overdue && bill.dueDate) {
      overdueCount += 1;
      totalOverdue = totalOverdue.plus(balance);
      s.overdue = s.overdue.plus(balance);
      s.overdueCount += 1;

      const daysOverdue = Math.floor((now.getTime() - bill.dueDate.getTime()) / MS_PER_DAY);
      const bucket = dayBuckets(daysOverdue);
      aging[bucket].count += 1;
      aging[bucket].amount = aging[bucket].amount.plus(balance);
    }
  }

  // Build supplier breakdown (sorted by outstanding desc), top 20.
  const supplierBreakdown = Array.from(supplierMap.values())
    .map((s) => ({
      supplierId: s.supplier.id,
      supplierNumber: s.supplier.supplierNumber,
      name: supplierDisplayName(s.supplier),
      status: s.supplier.status,
      outstanding: serializeMoney(s.outstanding),
      overdue: serializeMoney(s.overdue),
      billCount: s.billCount,
      overdueCount: s.overdueCount,
      oldestDueDate: s.oldestDueDate?.toISOString() ?? null,
    }))
    .sort((a, b) => toMoney(b.outstanding).cmp(toMoney(a.outstanding)))
    .slice(0, 20);

  return ok({
    summary: {
      totalPayable: serializeMoney(totalPayable),
      totalOverdue: serializeMoney(totalOverdue),
      outstandingCount,
      overdueCount,
      billCount,
    },
    aging: {
      "0-30": { count: aging["0-30"].count, amount: serializeMoney(aging["0-30"].amount) },
      "31-60": { count: aging["31-60"].count, amount: serializeMoney(aging["31-60"].amount) },
      "61-90": { count: aging["61-90"].count, amount: serializeMoney(aging["61-90"].amount) },
      "90+": { count: aging["90+"].count, amount: serializeMoney(aging["90+"].amount) },
    },
    supplierBreakdown,
    generatedAt: now.toISOString(),
  });
}
