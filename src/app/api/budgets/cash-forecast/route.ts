// ============================================================================
// LBMS Phase 12 API — Cash Forecast
// ----------------------------------------------------------------------------
// GET /api/budgets/cash-forecast
//   Projected closing cash = opening cash + expected AR collections
//                            − expected AP payments − planned budget expenses.
//
//   Sources (each is the authoritative source for its domain):
//   - Opening cash:        getTotalCashPosition() from @/lib/finance/reporting
//                           (derives from posted ledger entries — Finance).
//   - Expected AR:          Σ outstanding Invoice.balanceDue (status in
//                           issued|partially_paid) with dueDate within horizon.
//   - Expected AP:          Σ outstanding SupplierBill.balanceDue (status in
//                           posted|partially_paid|paid) with dueDate within
//                           horizon.
//   - Planned expenses:     Σ BudgetLine.amount where accountClass = "expense"
//                           from budgets with status in approved|locked, for
//                           months within the horizon.
//
//   Query params:
//     - horizon (default 30): the number of days ahead to forecast.
//
//   IMPORTANT: budgets NEVER post journals. They contribute ONLY planned
//   expenses to the forecast. Actuals are always from the Finance ledger.
//
//   Requires `budgets:view`.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  authorize,
  ok,
} from "@/lib/api-helpers";
import { getTotalCashPosition } from "@/lib/finance/reporting";
import { toMoney, serializeMoney, ZERO, type Money } from "@/lib/finance/money";

export async function GET(req: NextRequest) {
  const auth = await authorize("budgets", "view");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const horizonDays = Math.max(
    1,
    Math.min(365, Number(sp.get("horizon") ?? "30") || 30),
  );

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + horizonDays * 86400000);

  // --- 1. Opening cash (authoritative — derived from posted ledger entries) ---
  const openingCashStr = await getTotalCashPosition();
  const openingCash = toMoney(openingCashStr);

  // --- 2. Expected AR collections (outstanding invoices due within horizon) ---
  const outstandingInvoices = await db.invoice.findMany({
    where: {
      deletedAt: null,
      status: { in: ["issued", "partially_paid"] },
      balanceDue: { gt: 0 },
      dueDate: { gte: now, lte: horizonEnd },
    },
    select: {
      id: true,
      invoiceNumber: true,
      customerId: true,
      customer: { select: { id: true, tradingName: true, legalName: true } },
      dueDate: true,
      total: true,
      amountPaid: true,
      balanceDue: true,
      status: true,
    },
    orderBy: { dueDate: "asc" },
  });
  let expectedAR: Money = ZERO;
  for (const inv of outstandingInvoices) {
    expectedAR = expectedAR.plus(toMoney(inv.balanceDue));
  }

  // --- 3. Expected AP payments (outstanding bills due within horizon) ---
  const outstandingBills = await db.supplierBill.findMany({
    where: {
      deletedAt: null,
      status: { in: ["posted", "partially_paid", "paid"] },
      balanceDue: { gt: 0 },
      dueDate: { gte: now, lte: horizonEnd },
    },
    select: {
      id: true,
      billNumber: true,
      supplierId: true,
      supplier: {
        select: { id: true, supplierNumber: true, tradingName: true, legalName: true },
      },
      dueDate: true,
      total: true,
      amountPaid: true,
      balanceDue: true,
      status: true,
    },
    orderBy: { dueDate: "asc" },
  });
  let expectedAP: Money = ZERO;
  for (const bill of outstandingBills) {
    expectedAP = expectedAP.plus(toMoney(bill.balanceDue));
  }

  // --- 4. Planned budget expenses (from approved/locked budgets, within horizon months) ---
  // Determine which months fall within the horizon window (1-12).
  const monthSet = new Set<number>();
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  while (cursor <= horizonEnd) {
    monthSet.add(cursor.getMonth() + 1);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const months = Array.from(monthSet).sort((a, b) => a - b);

  const currentYear = now.getFullYear();
  const plannedLines = await db.budgetLine.findMany({
    where: {
      accountClass: "expense",
      month: { in: months },
      budget: {
        deletedAt: null,
        status: { in: ["approved", "locked"] },
        fiscalYear: currentYear,
      },
    },
    select: {
      id: true,
      ledgerAccountCode: true,
      month: true,
      amount: true,
      budget: {
        select: {
          id: true,
          budgetNumber: true,
          name: true,
          status: true,
          fiscalYear: true,
        },
      },
      department: { select: { id: true, name: true, code: true } },
      project: { select: { id: true, projectNumber: true, name: true } },
    },
    orderBy: [{ ledgerAccountCode: "asc" }, { month: "asc" }],
  });
  let plannedExpenses: Money = ZERO;
  for (const ln of plannedLines) {
    plannedExpenses = plannedExpenses.plus(toMoney(ln.amount));
  }

  // --- 5. Projected closing cash ---
  const projectedClosing = openingCash
    .plus(expectedAR)
    .minus(expectedAP)
    .minus(plannedExpenses);

  // --- 6. AR aging buckets (0-30 / 31-60 / 61-90 / 90+ days overdue) ---
  const allOutstandingInvoices = await db.invoice.findMany({
    where: {
      deletedAt: null,
      status: { in: ["issued", "partially_paid"] },
      balanceDue: { gt: 0 },
      dueDate: { lte: horizonEnd },
    },
    select: { dueDate: true, balanceDue: true },
  });
  const arBuckets: Record<string, Money> = {
    "0-30": ZERO,
    "31-60": ZERO,
    "61-90": ZERO,
    "90+": ZERO,
  };
  for (const inv of allOutstandingInvoices) {
    const due = inv.dueDate;
    if (due > now) continue; // not overdue yet (due in future)
    const daysOverdue = Math.floor((now.getTime() - due.getTime()) / 86400000);
    const bal = toMoney(inv.balanceDue);
    if (daysOverdue <= 30) arBuckets["0-30"] = arBuckets["0-30"].plus(bal);
    else if (daysOverdue <= 60) arBuckets["31-60"] = arBuckets["31-60"].plus(bal);
    else if (daysOverdue <= 90) arBuckets["61-90"] = arBuckets["61-90"].plus(bal);
    else arBuckets["90+"] = arBuckets["90+"].plus(bal);
  }

  // --- 7. AP aging buckets (0-30 / 31-60 / 61-90 / 90+ days overdue) ---
  const allOutstandingBills = await db.supplierBill.findMany({
    where: {
      deletedAt: null,
      status: { in: ["posted", "partially_paid", "paid"] },
      balanceDue: { gt: 0 },
      dueDate: { lte: horizonEnd },
    },
    select: { dueDate: true, balanceDue: true },
  });
  const apBuckets: Record<string, Money> = {
    "0-30": ZERO,
    "31-60": ZERO,
    "61-90": ZERO,
    "90+": ZERO,
  };
  for (const bill of allOutstandingBills) {
    if (!bill.dueDate) continue;
    const due = bill.dueDate;
    if (due > now) continue; // not overdue yet
    const daysOverdue = Math.floor((now.getTime() - due.getTime()) / 86400000);
    const bal = toMoney(bill.balanceDue);
    if (daysOverdue <= 30) apBuckets["0-30"] = apBuckets["0-30"].plus(bal);
    else if (daysOverdue <= 60) apBuckets["31-60"] = apBuckets["31-60"].plus(bal);
    else if (daysOverdue <= 90) apBuckets["61-90"] = apBuckets["61-90"].plus(bal);
    else apBuckets["90+"] = apBuckets["90+"].plus(bal);
  }

  return ok({
    generatedAt: now.toISOString(),
    horizonDays,
    period: {
      from: now.toISOString(),
      to: horizonEnd.toISOString(),
    },
    openingCash: serializeMoney(openingCash),
    expectedAR: {
      total: serializeMoney(expectedAR),
      count: outstandingInvoices.length,
      invoices: outstandingInvoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customer: inv.customer
          ? {
              id: inv.customer.id,
              name: inv.customer.tradingName || inv.customer.legalName || "—",
            }
          : null,
        dueDate: inv.dueDate.toISOString(),
        total: serializeMoney(inv.total),
        balanceDue: serializeMoney(inv.balanceDue),
        status: inv.status,
      })),
      agingBuckets: {
        "0-30": serializeMoney(arBuckets["0-30"]),
        "31-60": serializeMoney(arBuckets["31-60"]),
        "61-90": serializeMoney(arBuckets["61-90"]),
        "90+": serializeMoney(arBuckets["90+"]),
      },
    },
    expectedAP: {
      total: serializeMoney(expectedAP),
      count: outstandingBills.length,
      bills: outstandingBills.map((bill) => ({
        id: bill.id,
        billNumber: bill.billNumber,
        supplier: bill.supplier
          ? {
              id: bill.supplier.id,
              name: bill.supplier.tradingName || bill.supplier.legalName || "—",
            }
          : null,
        dueDate: bill.dueDate ? bill.dueDate.toISOString() : null,
        total: serializeMoney(bill.total),
        balanceDue: serializeMoney(bill.balanceDue),
        status: bill.status,
      })),
      agingBuckets: {
        "0-30": serializeMoney(apBuckets["0-30"]),
        "31-60": serializeMoney(apBuckets["31-60"]),
        "61-90": serializeMoney(apBuckets["61-90"]),
        "90+": serializeMoney(apBuckets["90+"]),
      },
    },
    plannedExpenses: {
      total: serializeMoney(plannedExpenses),
      lineCount: plannedLines.length,
      months,
      lines: plannedLines.map((ln) => ({
        id: ln.id,
        ledgerAccountCode: ln.ledgerAccountCode,
        month: ln.month,
        amount: serializeMoney(ln.amount),
        budget: ln.budget,
        department: ln.department,
        project: ln.project,
      })),
    },
    projectedClosingCash: serializeMoney(projectedClosing),
    summary: {
      inflows: serializeMoney(expectedAR),
      outflows: serializeMoney(expectedAP.plus(plannedExpenses)),
      netCashFlow: serializeMoney(
        expectedAR.minus(expectedAP).minus(plannedExpenses),
      ),
    },
  });
}
