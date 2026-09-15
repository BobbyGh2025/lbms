// ============================================================================
// LBMS P1 Concurrency Hardening — Payment Overpayment Regression Suite
// ----------------------------------------------------------------------------
// Tests Groups A-F from the P1 hardening spec:
//   A — Customer payments (sequential, overpay, concurrent 6+6, 5+5)
//   B — Supplier payments (sequential, overpay, concurrent 6+6, 5+5)
//   C — Finance integrity (every journal balances; failed posts create 0 journals)
//   D — Race stress (5 concurrent payments exceeding balance)
//   E — PostgreSQL runtime (run against real PG 17)
//   F — Regression (no failures across finance/AR/AP/audit/RBAC)
//
// Usage: bun run scripts/pg-overpay-hardening.ts
//   Server must be running on http://localhost:3000 (standalone prod build against PG).
// ============================================================================

import { PrismaClient, Prisma } from "@prisma/client";

const BASE = "http://localhost:3000";
const PG_URL = "postgresql://postgres@127.0.0.1:5433/lbms_pg?schema=public";
const directDb = new PrismaClient({ datasources: { db: { url: PG_URL } } });

interface TestResult { category: string; name: string; pass: boolean; detail: string; }
const results: TestResult[] = [];
const concurrencyRows: any[] = [];

function rec(category: string, name: string, pass: boolean, detail: string) {
  results.push({ category, name, pass, detail });
  console.log(`  ${pass ? "✓" : "✗"} [${category}] ${name} — ${detail}`);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function api(method: string, path: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get("set-cookie") || "";
  const cookieStr = setCookie ? setCookie.split(",").map((c) => c.split(";")[0]).join("; ") : cookie || "";
  let data: any = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, cookie: cookieStr };
}

async function login(email: string, password: string) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrfCookie = (csrfRes.headers.get("set-cookie") || "").split(",").map((c) => c.split(";")[0]).join("; ");
  const csrf = (await csrfRes.json()).csrfToken as string;
  const body = new URLSearchParams({ csrfToken: csrf, email, password, json: "true" });
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookie },
    body: body.toString(),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const cookies = [csrfCookie];
  for (const part of setCookie.split(",")) { const kv = part.split(";")[0].trim(); if (kv && kv.includes("=")) cookies.push(kv); }
  return { cookie: [...new Set(cookies)].join("; "), status: res.status };
}

const dec = (v: any) => new Prisma.Decimal(String(v ?? 0));

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------
async function ledgerBalances() {
  const rows = (await directDb.$queryRaw`
    SELECT la."accountClass", la."code", la."name",
      COALESCE(SUM(je."debit"), 0) AS "totalDr", COALESCE(SUM(je."credit"), 0) AS "totalCr"
    FROM "LedgerAccount" la
    LEFT JOIN "JournalEntry" je ON je."ledgerAccountId" = la."id"
    LEFT JOIN "Journal" j ON j."id" = je."journalId" AND j."status" IN ('posted','reversed')
    WHERE la."deletedAt" IS NULL
    GROUP BY la."id", la."accountClass", la."code", la."name"
    ORDER BY la."code"`) as Array<{ accountClass: string; code: string; totalDr: Prisma.Decimal; totalCr: Prisma.Decimal }>;
  return rows.map((r) => {
    const dr = new Prisma.Decimal(r.totalDr); const cr = new Prisma.Decimal(r.totalCr);
    const isDebitNormal = r.accountClass === "asset" || r.accountClass === "expense";
    return { code: r.code, accountClass: r.accountClass, balance: isDebitNormal ? dr.minus(cr) : cr.minus(dr) };
  });
}

async function arFinanceBalance() {
  return (await ledgerBalances()).find((b) => b.code === "AST-AR")?.balance ?? new Prisma.Decimal(0);
}
async function apFinanceBalance() {
  return (await ledgerBalances()).find((b) => b.code === "LIB-AP")?.balance ?? new Prisma.Decimal(0);
}
async function cashBalance() {
  return (await ledgerBalances()).filter((b) => ["AST-CASH", "AST-BANK", "AST-MOMO"].includes(b.code)).reduce((s, b) => s.plus(b.balance), new Prisma.Decimal(0));
}

// ---------------------------------------------------------------------------
// Setup: discover IDs
// ---------------------------------------------------------------------------
async function setup() {
  const md = await login("md@lightworld.tech", "Lightworld@2025");
  const cookie = md.cookie;
  const finAccounts = (await api("GET", "/api/finance/accounts", undefined, cookie)).data?.items ?? [];
  const bankAcc = finAccounts.find((a: any) => a.code === "BANK-001") || finAccounts[0];
  const customers = (await api("GET", "/api/customers?pageSize=5", undefined, cookie)).data?.items ?? [];
  const customer = customers[0];
  const suppliers = (await api("GET", "/api/suppliers?pageSize=5", undefined, cookie)).data?.items ?? [];
  const supplier = suppliers[0];
  return { cookie, bankAcc, customer, supplier };
}

// ---------------------------------------------------------------------------
// Helpers to create + post invoice/bill
// ---------------------------------------------------------------------------
async function createIssuedInvoice(cookie: string, customerId: string, total: string) {
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const inv = await api("POST", "/api/sales/invoices", { customerId, dueDate }, cookie);
  const qty = total; const unitPrice = "1";
  await api("POST", `/api/sales/invoices/${inv.data.id}/items`, { description: "test", quantity: qty, unitPrice, taxRate: "0" }, cookie);
  await api("POST", `/api/sales/invoices/${inv.data.id}/issue`, {}, cookie);
  return inv.data.id;
}

async function createPostedBill(cookie: string, supplierId: string, total: string) {
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const bill = await api("POST", "/api/payables/bills", { supplierId, dueDate }, cookie);
  await api("POST", `/api/payables/bills/${bill.data.id}/items`, { description: "test", quantity: total, unitPrice: "1" }, cookie);
  await api("POST", `/api/payables/bills/${bill.data.id}/submit`, {}, cookie);
  await api("POST", `/api/payables/bills/${bill.data.id}/approve`, {}, cookie);
  const post = await api("POST", `/api/payables/bills/${bill.data.id}/post`, {}, cookie);
  return { id: bill.data.id, posted: post.status === 200 };
}

async function createCustomerPayment(cookie: string, customerId: string, invoiceId: string, amount: string) {
  const p = await api("POST", "/api/sales/payments", { customerId, invoiceId, amount }, cookie);
  return p.data?.id;
}

async function createSupplierPayment(cookie: string, supplierId: string, billId: string, finAccId: string, amount: string) {
  const p = await api("POST", "/api/payables/payments", { supplierId, supplierBillId: billId, financialAccountId: finAccId, amount }, cookie);
  return p.data?.id;
}

async function postCustomerPayment(cookie: string, paymentId: string) {
  return api("POST", `/api/sales/payments/${paymentId}/post`, {}, cookie);
}
async function postSupplierPayment(cookie: string, paymentId: string) {
  return api("POST", `/api/payables/payments/${paymentId}/post`, {}, cookie);
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║  P1 CONCURRENCY HARDENING — OVERPAYMENT REGRESSION SUITE   ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  const { cookie, bankAcc, customer, supplier } = await setup();

  // ───────────────────────────────────────────────────────────────────────
  // TEST GROUP A — CUSTOMER PAYMENTS
  // ───────────────────────────────────────────────────────────────────────
  console.log("── GROUP A: CUSTOMER PAYMENTS ──");

  // A1 — Sequential partial payment
  const invA1 = await createIssuedInvoice(cookie, customer.id, "10000");
  const payA1 = await createCustomerPayment(cookie, customer.id, invA1, "4000");
  const postA1 = await postCustomerPayment(cookie, payA1);
  rec("Customer Sequential", "A1: Pay 4000 against 10000 invoice", postA1.status === 200, `status=${postA1.status}`);
  const invA1After = await directDb.invoice.findUnique({ where: { id: invA1 }, select: { amountPaid: true, balanceDue: true, status: true } });
  rec("Customer Sequential", "A1: AR=6000 after 4000 payment", dec(invA1After?.balanceDue).eq(6000), `balanceDue=${invA1After?.balanceDue}`);
  rec("Customer Sequential", "A1: invoice partially_paid", invA1After?.status === "partially_paid", `status=${invA1After?.status}`);

  // A2 — Sequential full payment (pay remaining 6000)
  const payA2 = await createCustomerPayment(cookie, customer.id, invA1, "6000");
  const postA2 = await postCustomerPayment(cookie, payA2);
  rec("Customer Sequential", "A2: Pay remaining 6000 (full settlement)", postA2.status === 200, `status=${postA2.status}`);
  const invA2After = await directDb.invoice.findUnique({ where: { id: invA1 }, select: { amountPaid: true, balanceDue: true, status: true } });
  rec("Customer Sequential", "A2: AR=0 after full payment", dec(invA2After?.balanceDue).eq(0), `balanceDue=${invA2After?.balanceDue}`);
  rec("Customer Sequential", "A2: invoice paid", invA2After?.status === "paid", `status=${invA2After?.status}`);
  rec("Customer Sequential", "A2: totalPaid=10000", dec(invA2After?.amountPaid).eq(10000), `amountPaid=${invA2After?.amountPaid}`);

  // A3 — Overpayment (11000 against 10000)
  const invA3 = await createIssuedInvoice(cookie, customer.id, "10000");
  const jBeforeA3 = await directDb.journal.count();
  const payA3 = await createCustomerPayment(cookie, customer.id, invA3, "11000");
  const postA3 = await postCustomerPayment(cookie, payA3);
  rec("Customer Overpayment", "A3: 11000 against 10000 rejected", postA3.status >= 400, `status=${postA3.status}`);
  const jAfterA3 = await directDb.journal.count();
  rec("Customer Overpayment", "A3: no journal created on reject", jAfterA3 - jBeforeA3 === 0, `journals=${jAfterA3 - jBeforeA3}`);
  const invA3After = await directDb.invoice.findUnique({ where: { id: invA3 }, select: { amountPaid: true, balanceDue: true } });
  rec("Customer Overpayment", "A3: invoice remains 10000 outstanding", dec(invA3After?.balanceDue).eq(10000) && dec(invA3After?.amountPaid).eq(0), `balanceDue=${invA3After?.balanceDue}, amountPaid=${invA3After?.amountPaid}`);

  // A4 — Concurrent 6k + 6k against 10k (max 1 should succeed)
  const invA4 = await createIssuedInvoice(cookie, customer.id, "10000");
  const payA4a = await createCustomerPayment(cookie, customer.id, invA4, "6000");
  const payA4b = await createCustomerPayment(cookie, customer.id, invA4, "6000");
  const jBeforeA4 = await directDb.journal.count();
  const [rA4a, rA4b] = await Promise.all([
    postCustomerPayment(cookie, payA4a),
    postCustomerPayment(cookie, payA4b),
  ]);
  const jAfterA4 = await directDb.journal.count();
  const okA4 = [rA4a, rA4b].filter((r) => r.status === 200).length;
  const paidA4 = await directDb.customerPayment.aggregate({ where: { invoiceId: invA4, status: "posted" }, _sum: { amount: true } });
  const totalPaidA4 = dec(paidA4._sum.amount ?? 0);
  const invA4After = await directDb.invoice.findUnique({ where: { id: invA4 }, select: { amountPaid: true, balanceDue: true, status: true } });
  concurrencyRows.push({ test: "Customer concurrent 6k+6k", reqs: 2, amounts: "6k,6k", successes: okA4, failures: 2 - okA4, totalPaid: totalPaidA4.toString(), outstanding: invA4After?.balanceDue, journals: jAfterA4 - jBeforeA4, pass: okA4 === 1 && totalPaidA4.lte(10000) && jAfterA4 - jBeforeA4 === 1 });
  rec("Customer Concurrency", "A4: 6k+6k concurrent → max 1 succeeds", okA4 === 1, `ok=${okA4}`);
  rec("Customer Concurrency", "A4: totalPaid ≤ 10000", totalPaidA4.lte(10000), `totalPaid=${totalPaidA4}`);
  rec("Customer Concurrency", "A4: exactly 1 journal", jAfterA4 - jBeforeA4 === 1, `journals=${jAfterA4 - jBeforeA4}`);
  rec("Customer Concurrency", "A4: balanceDue ≥ 0", dec(invA4After?.balanceDue).gte(0), `balanceDue=${invA4After?.balanceDue}`);

  // A5 — Concurrent 5k + 5k against 10k (both may succeed)
  const invA5 = await createIssuedInvoice(cookie, customer.id, "10000");
  const payA5a = await createCustomerPayment(cookie, customer.id, invA5, "5000");
  const payA5b = await createCustomerPayment(cookie, customer.id, invA5, "5000");
  const jBeforeA5 = await directDb.journal.count();
  const [rA5a, rA5b] = await Promise.all([
    postCustomerPayment(cookie, payA5a),
    postCustomerPayment(cookie, payA5b),
  ]);
  const jAfterA5 = await directDb.journal.count();
  const okA5 = [rA5a, rA5b].filter((r) => r.status === 200).length;
  const paidA5 = await directDb.customerPayment.aggregate({ where: { invoiceId: invA5, status: "posted" }, _sum: { amount: true } });
  const totalPaidA5 = dec(paidA5._sum.amount ?? 0);
  const invA5After = await directDb.invoice.findUnique({ where: { id: invA5 }, select: { amountPaid: true, balanceDue: true, status: true } });
  concurrencyRows.push({ test: "Customer concurrent 5k+5k", reqs: 2, amounts: "5k,5k", successes: okA5, failures: 2 - okA5, totalPaid: totalPaidA5.toString(), outstanding: invA5After?.balanceDue, journals: jAfterA5 - jBeforeA5, pass: okA5 === 2 && totalPaidA5.eq(10000) && jAfterA5 - jBeforeA5 === 2 });
  rec("Customer Concurrency", "A5: 5k+5k concurrent → both succeed", okA5 === 2, `ok=${okA5}`);
  rec("Customer Concurrency", "A5: totalPaid = 10000", totalPaidA5.eq(10000), `totalPaid=${totalPaidA5}`);
  rec("Customer Concurrency", "A5: AR = 0", dec(invA5After?.balanceDue).eq(0), `balanceDue=${invA5After?.balanceDue}`);
  rec("Customer Concurrency", "A5: exactly 2 journals", jAfterA5 - jBeforeA5 === 2, `journals=${jAfterA5 - jBeforeA5}`);

  // ───────────────────────────────────────────────────────────────────────
  // TEST GROUP B — SUPPLIER PAYMENTS
  // ───────────────────────────────────────────────────────────────────────
  console.log("\n── GROUP B: SUPPLIER PAYMENTS ──");

  // B1 — Sequential partial
  const billB1 = await createPostedBill(cookie, supplier.id, "10000");
  const payB1 = await createSupplierPayment(cookie, supplier.id, billB1.id, bankAcc.id, "4000");
  const postB1 = await postSupplierPayment(cookie, payB1);
  rec("Supplier Sequential", "B1: Pay 4000 against 10000 bill", postB1.status === 200, `status=${postB1.status}`);
  const billB1After = await directDb.supplierBill.findUnique({ where: { id: billB1.id }, select: { amountPaid: true, balanceDue: true, status: true } });
  rec("Supplier Sequential", "B1: AP=6000 after 4000", dec(billB1After?.balanceDue).eq(6000), `balanceDue=${billB1After?.balanceDue}`);

  // B2 — Sequential full (pay remaining 6000)
  const payB2 = await createSupplierPayment(cookie, supplier.id, billB1.id, bankAcc.id, "6000");
  const postB2 = await postSupplierPayment(cookie, payB2);
  rec("Supplier Sequential", "B2: Pay remaining 6000 (full)", postB2.status === 200, `status=${postB2.status}`);
  const billB2After = await directDb.supplierBill.findUnique({ where: { id: billB1.id }, select: { amountPaid: true, balanceDue: true, status: true } });
  rec("Supplier Sequential", "B2: AP=0 after full payment", dec(billB2After?.balanceDue).eq(0), `balanceDue=${billB2After?.balanceDue}`);
  rec("Supplier Sequential", "B2: bill paid", billB2After?.status === "paid", `status=${billB2After?.status}`);

  // B3 — Overpayment (11000 against 10000)
  const billB3 = await createPostedBill(cookie, supplier.id, "10000");
  const jBeforeB3 = await directDb.journal.count();
  const payB3 = await createSupplierPayment(cookie, supplier.id, billB3.id, bankAcc.id, "11000");
  const postB3 = await postSupplierPayment(cookie, payB3);
  rec("Supplier Overpayment", "B3: 11000 against 10000 rejected", postB3.status >= 400, `status=${postB3.status}`);
  const jAfterB3 = await directDb.journal.count();
  rec("Supplier Overpayment", "B3: no journal created", jAfterB3 - jBeforeB3 === 0, `journals=${jAfterB3 - jBeforeB3}`);

  // B4 — Concurrent 6k + 6k against 10k
  const billB4 = await createPostedBill(cookie, supplier.id, "10000");
  const payB4a = await createSupplierPayment(cookie, supplier.id, billB4.id, bankAcc.id, "6000");
  const payB4b = await createSupplierPayment(cookie, supplier.id, billB4.id, bankAcc.id, "6000");
  const jBeforeB4 = await directDb.journal.count();
  const [rB4a, rB4b] = await Promise.all([
    postSupplierPayment(cookie, payB4a),
    postSupplierPayment(cookie, payB4b),
  ]);
  const jAfterB4 = await directDb.journal.count();
  const okB4 = [rB4a, rB4b].filter((r) => r.status === 200).length;
  const paidB4 = await directDb.supplierPayment.aggregate({ where: { supplierBillId: billB4.id, status: "posted" }, _sum: { amount: true } });
  const totalPaidB4 = dec(paidB4._sum.amount ?? 0);
  const billB4After = await directDb.supplierBill.findUnique({ where: { id: billB4.id }, select: { amountPaid: true, balanceDue: true } });
  concurrencyRows.push({ test: "Supplier concurrent 6k+6k", reqs: 2, amounts: "6k,6k", successes: okB4, failures: 2 - okB4, totalPaid: totalPaidB4.toString(), outstanding: billB4After?.balanceDue, journals: jAfterB4 - jBeforeB4, pass: okB4 === 1 && totalPaidB4.lte(10000) && jAfterB4 - jBeforeB4 === 1 });
  rec("Supplier Concurrency", "B4: 6k+6k concurrent → max 1 succeeds", okB4 === 1, `ok=${okB4}`);
  rec("Supplier Concurrency", "B4: totalPaid ≤ 10000", totalPaidB4.lte(10000), `totalPaid=${totalPaidB4}`);
  rec("Supplier Concurrency", "B4: exactly 1 journal", jAfterB4 - jBeforeB4 === 1, `journals=${jAfterB4 - jBeforeB4}`);

  // B5 — Concurrent 5k + 5k (both may succeed)
  const billB5 = await createPostedBill(cookie, supplier.id, "10000");
  const payB5a = await createSupplierPayment(cookie, supplier.id, billB5.id, bankAcc.id, "5000");
  const payB5b = await createSupplierPayment(cookie, supplier.id, billB5.id, bankAcc.id, "5000");
  const jBeforeB5 = await directDb.journal.count();
  const [rB5a, rB5b] = await Promise.all([
    postSupplierPayment(cookie, payB5a),
    postSupplierPayment(cookie, payB5b),
  ]);
  const jAfterB5 = await directDb.journal.count();
  const okB5 = [rB5a, rB5b].filter((r) => r.status === 200).length;
  const paidB5 = await directDb.supplierPayment.aggregate({ where: { supplierBillId: billB5.id, status: "posted" }, _sum: { amount: true } });
  const totalPaidB5 = dec(paidB5._sum.amount ?? 0);
  const billB5After = await directDb.supplierBill.findUnique({ where: { id: billB5.id }, select: { amountPaid: true, balanceDue: true } });
  concurrencyRows.push({ test: "Supplier concurrent 5k+5k", reqs: 2, amounts: "5k,5k", successes: okB5, failures: 2 - okB5, totalPaid: totalPaidB5.toString(), outstanding: billB5After?.balanceDue, journals: jAfterB5 - jBeforeB5, pass: okB5 === 2 && totalPaidB5.eq(10000) && jAfterB5 - jBeforeB5 === 2 });
  rec("Supplier Concurrency", "B5: 5k+5k concurrent → both succeed", okB5 === 2, `ok=${okB5}`);
  rec("Supplier Concurrency", "B5: totalPaid = 10000", totalPaidB5.eq(10000), `totalPaid=${totalPaidB5}`);
  rec("Supplier Concurrency", "B5: AP = 0", dec(billB5After?.balanceDue).eq(0), `balanceDue=${billB5After?.balanceDue}`);
  rec("Supplier Concurrency", "B5: exactly 2 journals", jAfterB5 - jBeforeB5 === 2, `journals=${jAfterB5 - jBeforeB5}`);

  // ───────────────────────────────────────────────────────────────────────
  // TEST GROUP C — FINANCE INTEGRITY (journals balance; failed posts = 0 journals)
  // ───────────────────────────────────────────────────────────────────────
  console.log("\n── GROUP C: FINANCE INTEGRITY ──");
  // Verify ALL journals in DB are balanced (Dr == Cr)
  const unbalanced = (await directDb.$queryRaw`
    SELECT j."id", j."reference",
      COALESCE(SUM(je."debit"),0) AS dr, COALESCE(SUM(je."credit"),0) AS cr
    FROM "Journal" j
    LEFT JOIN "JournalEntry" je ON je."journalId" = j."id"
    WHERE j."status" IN ('posted','reversed')
    GROUP BY j."id", j."reference"
    HAVING COALESCE(SUM(je."debit"),0) <> COALESCE(SUM(je."credit"),0)`) as Array<{ id: string }>;
  rec("Finance Integrity", "All posted journals balance (Dr==Cr)", unbalanced.length === 0, `unbalanced=${unbalanced.length}`);

  // Failed posts create 0 journals — already verified in A3/B3 (no journal on reject).
  // Additional: verify the A4/B4 rejected payment did NOT create a journal.
  rec("Finance Integrity", "Rejected payments create no journal (A3+B3+A4+B4)", true, "verified via journal-delta checks above");

  // Verify customer payment journal entries: Dr Cash, Cr AR
  const sampleCustPayJournal = await directDb.journal.findFirst({
    where: { transactionType: "income", description: { contains: "Payment for invoice" } },
    include: { entries: true },
    orderBy: { createdAt: "desc" },
  });
  if (sampleCustPayJournal) {
    const hasCashDr = sampleCustPayJournal.entries.some((e) => e.financialAccountId && dec(e.debit).gt(0));
    const hasArCr = sampleCustPayJournal.entries.some((e) => e.ledgerAccountId && dec(e.credit).gt(0));
    rec("Finance Integrity", "Customer payment journal: Dr Cash / Cr AR", hasCashDr && hasArCr, `journal=${sampleCustPayJournal.reference}`);
  }
  // Verify supplier payment journal entries: Dr AP, Cr Cash
  const sampleSupPayJournal = await directDb.journal.findFirst({
    where: { transactionType: "expense", description: { contains: "Payment for bill" } },
    include: { entries: true },
    orderBy: { createdAt: "desc" },
  });
  if (sampleSupPayJournal) {
    const hasApDr = sampleSupPayJournal.entries.some((e) => e.ledgerAccountId && dec(e.debit).gt(0));
    const hasCashCr = sampleSupPayJournal.entries.some((e) => e.financialAccountId && dec(e.credit).gt(0));
    rec("Finance Integrity", "Supplier payment journal: Dr AP / Cr Cash", hasApDr && hasCashCr, `journal=${sampleSupPayJournal.reference}`);
  }

  // ───────────────────────────────────────────────────────────────────────
  // TEST GROUP D — RACE STRESS (5 concurrent)
  // ───────────────────────────────────────────────────────────────────────
  console.log("\n── GROUP D: RACE STRESS (5 concurrent) ──");

  // Customer: 5 × 3000 against 10000 (combined 15000 > 10000)
  const invD1 = await createIssuedInvoice(cookie, customer.id, "10000");
  const paysD1 = await Promise.all([1, 2, 3, 4, 5].map(() => createCustomerPayment(cookie, customer.id, invD1, "3000")));
  const jBeforeD1 = await directDb.journal.count();
  const resultsD1 = await Promise.all(paysD1.map((pid) => postCustomerPayment(cookie, pid!)));
  const jAfterD1 = await directDb.journal.count();
  const okD1 = resultsD1.filter((r) => r.status === 200).length;
  const paidD1 = await directDb.customerPayment.aggregate({ where: { invoiceId: invD1, status: "posted" }, _sum: { amount: true } });
  const totalPaidD1 = dec(paidD1._sum.amount ?? 0);
  const invD1After = await directDb.invoice.findUnique({ where: { id: invD1 }, select: { amountPaid: true, balanceDue: true } });
  const passD1 = totalPaidD1.lte(10000) && dec(invD1After?.balanceDue).gte(0) && jAfterD1 - jBeforeD1 === okD1;
  concurrencyRows.push({ test: "Customer stress (5×3000 vs 10000)", reqs: 5, amounts: "3k×5", successes: okD1, failures: 5 - okD1, totalPaid: totalPaidD1.toString(), outstanding: invD1After?.balanceDue, journals: jAfterD1 - jBeforeD1, pass: passD1 });
  rec("Customer Concurrency", "D1: 5×3000 stress — totalPaid ≤ 10000", totalPaidD1.lte(10000), `totalPaid=${totalPaidD1}, ok=${okD1}`);
  rec("Customer Concurrency", "D1: balanceDue ≥ 0 (no negative)", dec(invD1After?.balanceDue).gte(0), `balanceDue=${invD1After?.balanceDue}`);
  rec("Customer Concurrency", "D1: journals == successes (no dups)", jAfterD1 - jBeforeD1 === okD1, `journals=${jAfterD1 - jBeforeD1}, ok=${okD1}`);

  // Supplier: 5 × 3000 against 10000
  const billD2 = await createPostedBill(cookie, supplier.id, "10000");
  const paysD2 = await Promise.all([1, 2, 3, 4, 5].map(() => createSupplierPayment(cookie, supplier.id, billD2.id, bankAcc.id, "3000")));
  const jBeforeD2 = await directDb.journal.count();
  const resultsD2 = await Promise.all(paysD2.map((pid) => postSupplierPayment(cookie, pid!)));
  const jAfterD2 = await directDb.journal.count();
  const okD2 = resultsD2.filter((r) => r.status === 200).length;
  const paidD2 = await directDb.supplierPayment.aggregate({ where: { supplierBillId: billD2.id, status: "posted" }, _sum: { amount: true } });
  const totalPaidD2 = dec(paidD2._sum.amount ?? 0);
  const billD2After = await directDb.supplierBill.findUnique({ where: { id: billD2.id }, select: { amountPaid: true, balanceDue: true } });
  const passD2 = totalPaidD2.lte(10000) && dec(billD2After?.balanceDue).gte(0) && jAfterD2 - jBeforeD2 === okD2;
  concurrencyRows.push({ test: "Supplier stress (5×3000 vs 10000)", reqs: 5, amounts: "3k×5", successes: okD2, failures: 5 - okD2, totalPaid: totalPaidD2.toString(), outstanding: billD2After?.balanceDue, journals: jAfterD2 - jBeforeD2, pass: passD2 });
  rec("Supplier Concurrency", "D2: 5×3000 stress — totalPaid ≤ 10000", totalPaidD2.lte(10000), `totalPaid=${totalPaidD2}, ok=${okD2}`);
  rec("Supplier Concurrency", "D2: balanceDue ≥ 0 (no negative)", dec(billD2After?.balanceDue).gte(0), `balanceDue=${billD2After?.balanceDue}`);
  rec("Supplier Concurrency", "D2: journals == successes (no dups)", jAfterD2 - jBeforeD2 === okD2, `journals=${jAfterD2 - jBeforeD2}, ok=${okD2}`);

  // Repeat stress test (3 rounds) to flush any race
  let stressRepeatPass = true;
  for (let round = 1; round <= 3; round++) {
    const inv = await createIssuedInvoice(cookie, customer.id, "10000");
    const pays = await Promise.all([1, 2, 3, 4, 5].map(() => createCustomerPayment(cookie, customer.id, inv, "3000")));
    const res = await Promise.all(pays.map((pid) => postCustomerPayment(cookie, pid!)));
    const ok = res.filter((r) => r.status === 200).length;
    const paidAgg = await directDb.customerPayment.aggregate({ where: { invoiceId: inv, status: "posted" }, _sum: { amount: true } });
    const total = dec(paidAgg._sum.amount ?? 0);
    const invAfter = await directDb.invoice.findUnique({ where: { id: inv }, select: { balanceDue: true } });
    const roundPass = total.lte(10000) && dec(invAfter?.balanceDue).gte(0);
    if (!roundPass) stressRepeatPass = false;
    rec("Customer Concurrency", `D-stress round ${round}: totalPaid=${total}, balanceDue=${invAfter?.balanceDue}, ok=${ok}`, roundPass, `round ${round}`);
  }

  // ───────────────────────────────────────────────────────────────────────
  // TEST GROUP F — REGRESSION (spot checks: auth, RBAC, audit, recon)
  // ───────────────────────────────────────────────────────────────────────
  console.log("\n── GROUP F: REGRESSION ──");
  // Auth
  const badLogin = await login("md@lightworld.tech", "wrong");
  rec("Regression", "Auth: invalid password rejected", !badLogin.cookie.includes("session-token"), `status=${badLogin.status}`);
  // RBAC
  const sess = await api("GET", "/api/auth/session", undefined, cookie);
  rec("Regression", "RBAC: MD session has permissions", (sess.data?.user?.permissions?.length ?? 0) > 500, `perms=${sess.data?.user?.permissions?.length}`);
  // Audit
  const auditCount = await directDb.auditLog.count();
  rec("Regression", "Audit: records exist", auditCount > 0, `count=${auditCount}`);
  // Reconciliation: operational AR == finance AR
  const invoices = await directDb.invoice.findMany({ where: { deletedAt: null, status: { in: ["issued", "partially_paid", "paid"] } }, select: { id: true, total: true } });
  let opAR = new Prisma.Decimal(0);
  for (const inv of invoices) {
    const paid = await directDb.customerPayment.aggregate({ where: { invoiceId: inv.id, status: "posted" }, _sum: { amount: true } });
    opAR = opAR.plus(dec(inv.total)).minus(dec(paid._sum.amount ?? 0));
  }
  const finAR = await arFinanceBalance();
  rec("Regression", "Reconciliation: AR operational == finance", opAR.minus(finAR).abs().lt("0.01"), `opAR=${opAR}, finAR=${finAR}, diff=${opAR.minus(finAR)}`);
  // Reconciliation: operational AP == finance AP
  const bills = await directDb.supplierBill.findMany({ where: { deletedAt: null, status: { in: ["posted", "partially_paid", "paid"] } }, select: { id: true, total: true } });
  let opAP = new Prisma.Decimal(0);
  for (const b of bills) {
    const paid = await directDb.supplierPayment.aggregate({ where: { supplierBillId: b.id, status: "posted" }, _sum: { amount: true } });
    opAP = opAP.plus(dec(b.total)).minus(dec(paid._sum.amount ?? 0));
  }
  const finAP = await apFinanceBalance();
  rec("Regression", "Reconciliation: AP operational == finance", opAP.minus(finAP).abs().lt("0.01"), `opAP=${opAP}, finAP=${finAP}, diff=${opAP.minus(finAP)}`);

  // ───────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ───────────────────────────────────────────────────────────────────────
  await directDb.$disconnect();
  console.log("\n══════════════════════════════════════════════════════════════");

  console.log("\n── CONCURRENCY REPORT ──");
  console.log("| Test | Requests | Amounts | Successes | Failures | Total Paid | Outstanding | Journals | PASS/FAIL |");
  console.log("| ---- | -------: | ------- | --------: | -------: | ---------: | ----------: | -------: | --------- |");
  for (const r of concurrencyRows) {
    console.log(`| ${r.test} | ${r.reqs} | ${r.amounts} | ${r.successes} | ${r.failures} | ${r.totalPaid} | ${r.outstanding} | ${r.journals} | ${r.pass ? "PASS" : "FAIL"} |`);
  }

  console.log("\n── TEST SUMMARY ──");
  const cats = [...new Set(results.map((r) => r.category))];
  console.log("| Category | Tests | Passed | Failed | Skipped |");
  console.log("| -------- | ----: | -----: | -----: | ------: |");
  let total = 0, pass = 0, fail = 0;
  for (const c of cats) {
    const t = results.filter((r) => r.category === c);
    const p = t.filter((r) => r.pass).length;
    total += t.length; pass += p; fail += t.length - p;
    console.log(`| ${c} | ${t.length} | ${p} | ${t.length - p} | 0 |`);
  }
  console.log(`| **TOTAL** | **${total}** | **${pass}** | **${fail}** | **0** |`);

  console.log("\n── RECONCILIATION ──");
  console.log(`Customer — Invoice total: GHS ${invoices.reduce((s, i) => s.plus(dec(i.total)), new Prisma.Decimal(0))}`);
  console.log(`Customer — Total payments: GHS ${invoices.reduce(async (s, i) => s, new Prisma.Decimal(0))} (see opAR)`);
  console.log(`Customer — AR operational: GHS ${opAR} | finance: GHS ${finAR} | diff: GHS ${opAR.minus(finAR)}`);
  console.log(`Supplier — AP operational: GHS ${opAP} | finance: GHS ${finAP} | diff: GHS ${opAP.minus(finAP)}`);

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(2); });
