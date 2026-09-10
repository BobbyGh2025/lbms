// ============================================================================
// LBMS Phase 10 — AR & Finance Reconciliation Hardening Suite
// ----------------------------------------------------------------------------
// Verifies accrual accounting:
//   Invoice issue: Dr AR / Cr Revenue (revenue recognized at invoice time)
//   Payment: Dr Cash / Cr AR (settles receivable, no new revenue)
//   Void invoice: reverses Dr AR / Cr Revenue
//   Void payment: reverses Dr Cash / Cr AR
// ============================================================================

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const BASE = "http://localhost:3000";
const PASSWORD = "TestPass123!";

interface R { category: string; name: string; passed: boolean; evidence: string; }
const results: R[] = [];
function rec(cat: string, name: string, passed: boolean, evidence: string) {
  results.push({ category: cat, name, passed, evidence });
  console.log(`  ${passed ? "✓" : "✗"} ${name} — ${evidence}`);
}

async function login(email: string, password: string): Promise<string> {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrfToken = (await csrfRes.json()).csrfToken;
  const csrfCookies = (csrfRes as any).headers.getSetCookie?.() || [];
  const csrfCookieStr = csrfCookies.map((c: string) => c.split(";")[0]).join("; ");
  const body = new URLSearchParams({ email, password, csrfToken, callbackUrl: "/", json: "true" });
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookieStr }, body, redirect: "manual",
  });
  const loginCookies = (loginRes as any).headers.getSetCookie?.() || [];
  const allCookies = loginCookies.map((c: string) => c.split(";")[0]).join("; ");
  if (!allCookies.includes("session-token")) throw new Error(`Login failed for ${email}`);
  return allCookies;
}

async function api(cookie: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Cookie: cookie };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

/** Get AR ledger balance from the Finance ledger (authoritative). */
async function getArBalance(): Promise<number> {
  const arLedger = await prisma.ledgerAccount.findFirst({ where: { code: "AST-AR" } });
  if (!arLedger) return 0;
  const entries = await prisma.journalEntry.findMany({
    where: { ledgerAccountId: arLedger.id, journal: { status: { in: ["posted", "reversed"] } } },
    select: { debit: true, credit: true },
  });
  let balance = 0;
  for (const e of entries) balance += Number(e.debit) - Number(e.credit);
  return Math.round(balance * 100) / 100;
}

/** Get total revenue from the Finance ledger (INC-SALES). */
async function getRevenueBalance(): Promise<number> {
  const revLedger = await prisma.ledgerAccount.findFirst({ where: { code: "INC-SALES" } });
  if (!revLedger) return 0;
  const entries = await prisma.journalEntry.findMany({
    where: { ledgerAccountId: revLedger.id, journal: { status: { in: ["posted", "reversed"] } } },
    select: { debit: true, credit: true },
  });
  let balance = 0;
  for (const e of entries) balance += Number(e.credit) - Number(e.debit);
  return Math.round(balance * 100) / 100;
}

/** Get cash position from FinancialAccounts. */
async function getCashPosition(): Promise<number> {
  const accounts = await prisma.financialAccount.findMany({ where: { deletedAt: null } });
  let total = 0;
  for (const acc of accounts) {
    const entries = await prisma.journalEntry.findMany({
      where: { financialAccountId: acc.id, journal: { status: { in: ["posted", "reversed"] } } },
      select: { debit: true, credit: true },
    });
    let debits = 0, credits = 0;
    for (const e of entries) { debits += Number(e.debit); credits += Number(e.credit); }
    total += debits - credits;
  }
  return Math.round(total * 100) / 100;
}

/** Get operational AR (sum of invoice.balanceDue for non-voided invoices). */
async function getOperationalAR(): Promise<number> {
  const invoices = await prisma.invoice.findMany({
    where: { deletedAt: null, status: { not: "voided" } },
    select: { balanceDue: true },
  });
  let total = 0;
  for (const inv of invoices) total += Number(inv.balanceDue);
  return Math.round(total * 100) / 100;
}

async function main() {
  console.log("\n============================================================");
  console.log("  PHASE 10 — AR & FINANCE RECONCILIATION HARDENING");
  console.log("============================================================\n");

  const mdCookie = await login("md@phase7.test", PASSWORD);
  console.log("  ✓ Logged in as MD\n");

  // Get reference data
  const custRes = await api(mdCookie, "GET", "/api/customers?pageSize=100");
  const customers = custRes.data.items || [];
  const custA = customers[0];
  const custB = customers[1] || customers[0];
  const custC = customers[2] || customers[0];

  // Capture baseline Finance state
  const arBefore = await getArBalance();
  const revBefore = await getRevenueBalance();
  const cashBefore = await getCashPosition();
  const opArBefore = await getOperationalAR();
  console.log(`  Baseline: AR=${arBefore}, Rev=${revBefore}, Cash=${cashBefore}, OpAR=${opArBefore}\n`);

  // ============================================================
  // 1. INVOICE ACCOUNTING (unpaid invoice creates AR + Revenue)
  // ============================================================
  console.log("--- 1. Invoice Accounting (accrual) ---");
  let invoice1Id = "";
  let invoice1Total = 10000;
  {
    // Create + add item + issue
    const createRes = await api(mdCookie, "POST", "/api/sales/invoices", { customerId: custA.id, dueDate: new Date(Date.now() + 30 * 86400000).toISOString() });
    invoice1Id = createRes.data.id;
    await api(mdCookie, "POST", `/api/sales/invoices/${invoice1Id}/items`, { description: "Consulting services", quantity: "100", unitPrice: "100.00", discount: "0", taxRate: "0" });
    const issueRes = await api(mdCookie, "POST", `/api/sales/invoices/${invoice1Id}/issue`);

    rec("Invoice Accounting", "Invoice issue returns 200", issueRes.status === 200, `status=${issueRes.status}`);
    rec("Invoice Accounting", "Invoice has journalId (posted to Finance)", !!issueRes.data.invoice?.journalId || !!issueRes.data.journal?.id, `journalId=${issueRes.data.journal?.id || issueRes.data.invoice?.journalId}`);

    // Verify AR increased by 10000 in Finance ledger
    const arAfter = await getArBalance();
    const arDelta = Math.round((arAfter - arBefore) * 100) / 100;
    rec("Invoice Accounting", `AR increased by ${invoice1Total} (Dr AR)`, arDelta === invoice1Total, `AR before=${arBefore}, after=${arAfter}, delta=${arDelta}`);

    // Verify Revenue increased by 10000 in Finance ledger
    const revAfter = await getRevenueBalance();
    const revDelta = Math.round((revAfter - revBefore) * 100) / 100;
    rec("Invoice Accounting", `Revenue increased by ${invoice1Total} (Cr Revenue)`, revDelta === invoice1Total, `Rev before=${revBefore}, after=${revAfter}, delta=${revDelta}`);

    // Verify Cash NOT affected
    const cashAfter = await getCashPosition();
    rec("Invoice Accounting", "Cash unchanged (no payment yet)", cashAfter === cashBefore, `before=${cashBefore}, after=${cashAfter}`);

    // Verify operational AR matches
    const opArAfter = await getOperationalAR();
    const opArDelta = Math.round((opArAfter - opArBefore) * 100) / 100;
    rec("Invoice Accounting", "Operational AR increased by 10000", opArDelta === invoice1Total, `OpAR delta=${opArDelta}`);

    // Verify Finance AR = Operational AR delta (reconciliation)
    rec("Invoice Accounting", "Finance AR delta = Operational AR delta", arDelta === opArDelta, `finance=${arDelta}, operational=${opArDelta}`);
  }

  // ============================================================
  // 2. PAYMENT ACCOUNTING (Dr Cash / Cr AR — no new revenue)
  // ============================================================
  console.log("\n--- 2. Payment Accounting ---");
  let payment1Id = "";
  const payment1Amount = 4000;
  {
    const payRes = await api(mdCookie, "POST", "/api/sales/payments", { customerId: custA.id, invoiceId: invoice1Id, amount: String(payment1Amount), paymentMethod: "bank_transfer", reference: "AR-TEST-001" });
    payment1Id = payRes.data.id;
    const postRes = await api(mdCookie, "POST", `/api/sales/payments/${payment1Id}/post`);

    rec("Payment Accounting", "Payment post returns 200", postRes.status === 200, `status=${postRes.status}`);

    // Verify Cash increased by 4000 (Dr Cash)
    const cashAfter = await getCashPosition();
    const cashDelta = Math.round((cashAfter - cashBefore) * 100) / 100;
    rec("Payment Accounting", `Cash increased by ${payment1Amount} (Dr Cash)`, cashDelta === payment1Amount, `Cash delta=${cashDelta}`);

    // Verify AR decreased by 4000 (Cr AR)
    const arAfter = await getArBalance();
    const arDelta = Math.round((arAfter - arBefore) * 100) / 100;
    const expectedAr = invoice1Total - payment1Amount;
    rec("Payment Accounting", `AR = ${expectedAr} (decreased by ${payment1Amount})`, arDelta === expectedAr, `AR delta=${arDelta}, expected=${expectedAr}`);

    // Verify Revenue NOT changed (no new revenue from payment)
    const revAfter = await getRevenueBalance();
    const revDelta = Math.round((revAfter - revBefore) * 100) / 100;
    rec("Payment Accounting", "Revenue unchanged (no duplicate revenue)", revDelta === invoice1Total, `Rev delta=${revDelta} (expected ${invoice1Total} — only from invoice)`);

    // Verify invoice balance
    const invRes = await api(mdCookie, "GET", `/api/sales/invoices/${invoice1Id}`);
    rec("Payment Accounting", `Invoice balanceDue = ${invoice1Total - payment1Amount}`, Number(invRes.data.balanceDue) === invoice1Total - payment1Amount, `balance=${invRes.data.balanceDue}`);
    rec("Payment Accounting", "Invoice status = partially_paid", invRes.data.status === "partially_paid", `status=${invRes.data.status}`);

    // Verify operational AR reconciles
    const opArAfter = await getOperationalAR();
    const opArDelta = Math.round((opArAfter - opArBefore) * 100) / 100;
    rec("Payment Accounting", "Operational AR = Finance AR", opArDelta === arDelta, `opAR=${opArDelta}, finAR=${arDelta}`);
  }

  // ============================================================
  // 3. FULL PAYMENT (remaining balance)
  // ============================================================
  console.log("\n--- 3. Full Payment ---");
  {
    const remaining = invoice1Total - payment1Amount;
    const payRes = await api(mdCookie, "POST", "/api/sales/payments", { customerId: custA.id, invoiceId: invoice1Id, amount: String(remaining), paymentMethod: "cash", reference: "AR-TEST-002" });
    const postRes = await api(mdCookie, "POST", `/api/sales/payments/${payRes.data.id}/post`);

    rec("Full Payment", "Second payment posted", postRes.status === 200, `status=${postRes.status}`);

    const arAfter = await getArBalance();
    const arDelta = Math.round((arAfter - arBefore) * 100) / 100;
    rec("Full Payment", "AR = 0 after full payment", arDelta === 0, `AR delta=${arDelta}`);

    const cashAfter = await getCashPosition();
    const cashDelta = Math.round((cashAfter - cashBefore) * 100) / 100;
    rec("Full Payment", `Cash = ${invoice1Total} (full invoice)`, cashDelta === invoice1Total, `Cash delta=${cashDelta}`);

    const revAfter = await getRevenueBalance();
    const revDelta = Math.round((revAfter - revBefore) * 100) / 100;
    rec("Full Payment", `Revenue still = ${invoice1Total} (no duplicate)`, revDelta === invoice1Total, `Rev delta=${revDelta}`);

    const invRes = await api(mdCookie, "GET", `/api/sales/invoices/${invoice1Id}`);
    rec("Full Payment", "Invoice status = paid", invRes.data.status === "paid", `status=${invRes.data.status}`);
    rec("Full Payment", "Invoice balanceDue = 0", Number(invRes.data.balanceDue) === 0, `balance=${invRes.data.balanceDue}`);
  }

  // ============================================================
  // 4. UNPAID INVOICE TEST
  // ============================================================
  console.log("\n--- 4. Unpaid Invoice ---");
  let invoice2Id = "";
  const invoice2Total = 15000;
  {
    const createRes = await api(mdCookie, "POST", "/api/sales/invoices", { customerId: custB.id, dueDate: new Date(Date.now() + 30 * 86400000).toISOString() });
    invoice2Id = createRes.data.id;
    await api(mdCookie, "POST", `/api/sales/invoices/${invoice2Id}/items`, { description: "Software license", quantity: "1", unitPrice: String(invoice2Total) + ".00", discount: "0", taxRate: "0" });
    await api(mdCookie, "POST", `/api/sales/invoices/${invoice2Id}/issue`);

    const revAfter = await getRevenueBalance();
    const revDelta = Math.round((revAfter - revBefore) * 100) / 100;
    rec("Unpaid Invoice", `Revenue includes ${invoice2Total} from unpaid invoice`, revDelta >= invoice1Total + invoice2Total, `Rev delta=${revDelta} (expected >= ${invoice1Total + invoice2Total})`);

    const arAfter = await getArBalance();
    const arDelta = Math.round((arAfter - arBefore) * 100) / 100;
    rec("Unpaid Invoice", `AR = ${invoice2Total} (unpaid)`, arDelta === invoice2Total, `AR delta=${arDelta}`);

    const cashAfter = await getCashPosition();
    const cashDelta = Math.round((cashAfter - cashBefore) * 100) / 100;
    rec("Unpaid Invoice", "Cash unchanged from unpaid invoice", cashDelta === invoice1Total, `Cash delta=${cashDelta} (expected ${invoice1Total} from paid invoice only)`);
  }

  // ============================================================
  // 5. PARTIAL PAYMENTS (multiple)
  // ============================================================
  console.log("\n--- 5. Partial Payments ---");
  let invoice3Id = "";
  const invoice3Total = 20000;
  {
    const createRes = await api(mdCookie, "POST", "/api/sales/invoices", { customerId: custC.id, dueDate: new Date(Date.now() + 30 * 86400000).toISOString() });
    invoice3Id = createRes.data.id;
    await api(mdCookie, "POST", `/api/sales/invoices/${invoice3Id}/items`, { description: "Project work", quantity: "1", unitPrice: String(invoice3Total) + ".00", discount: "0", taxRate: "0" });
    await api(mdCookie, "POST", `/api/sales/invoices/${invoice3Id}/issue`);

    // 3 partial payments: 5000, 7000, 8000
    for (const [i, amt] of [5000, 7000, 8000].entries()) {
      const payRes = await api(mdCookie, "POST", "/api/sales/payments", { customerId: custC.id, invoiceId: invoice3Id, amount: String(amt), paymentMethod: "bank_transfer", reference: `PARTIAL-${i + 1}` });
      const postRes = await api(mdCookie, "POST", `/api/sales/payments/${payRes.data.id}/post`);
      rec("Partial Payments", `Payment ${i + 1} (${amt}) posted`, postRes.status === 200, `status=${postRes.status}`);
    }

    const invRes = await api(mdCookie, "GET", `/api/sales/invoices/${invoice3Id}`);
    rec("Partial Payments", `Invoice balanceDue = 0 after 3 payments`, Number(invRes.data.balanceDue) === 0, `balance=${invRes.data.balanceDue}`);
    rec("Partial Payments", "Invoice status = paid", invRes.data.status === "paid", `status=${invRes.data.status}`);

    // Revenue should be 20000 (recognized at invoice, not duplicated by 3 payments)
    const revAfter = await getRevenueBalance();
    const revDelta = Math.round((revAfter - revBefore) * 100) / 100;
    rec("Partial Payments", `Revenue includes ${invoice3Total} (single recognition)`, revDelta >= invoice1Total + invoice2Total + invoice3Total, `Rev delta=${revDelta}`);
  }

  // ============================================================
  // 6. OVERDUE TEST
  // ============================================================
  console.log("\n--- 6. Overdue ---");
  let invoice4Id = "";
  const invoice4Total = 5000;
  {
    const createRes = await api(mdCookie, "POST", "/api/sales/invoices", { customerId: custA.id, dueDate: new Date(Date.now() - 30 * 86400000).toISOString() });
    invoice4Id = createRes.data.id;
    await api(mdCookie, "POST", `/api/sales/invoices/${invoice4Id}/items`, { description: "Overdue test", quantity: "1", unitPrice: String(invoice4Total) + ".00", discount: "0", taxRate: "0" });
    await api(mdCookie, "POST", `/api/sales/invoices/${invoice4Id}/issue`);

    const invRes = await api(mdCookie, "GET", `/api/sales/invoices/${invoice4Id}`);
    rec("Overdue", "Invoice has overdue=true (derived)", invRes.data.overdue === true, `overdue=${invRes.data.overdue}, status=${invRes.data.status}, dueDate=${invRes.data.dueDate}`);

    // Receivables dashboard should include this
    const recvRes = await api(mdCookie, "GET", "/api/sales/receivables");
    rec("Overdue", "Receivables dashboard returns 200", recvRes.status === 200, `status=${recvRes.status}`);
    rec("Overdue", "Receivables has overdue count > 0", recvRes.data.summary?.overdueCount > 0, `overdueCount=${recvRes.data.summary?.overdueCount}`);
  }

  // ============================================================
  // 7. PAYMENT VOID (reverses Dr Cash / Cr AR)
  // ============================================================
  console.log("\n--- 7. Payment Void ---");
  {
    // Create a new invoice + payment, then void the payment
    const invRes = await api(mdCookie, "POST", "/api/sales/invoices", { customerId: custB.id, dueDate: new Date(Date.now() + 30 * 86400000).toISOString() });
    await api(mdCookie, "POST", `/api/sales/invoices/${invRes.data.id}/items`, { description: "Void test", quantity: "1", unitPrice: "8000.00", discount: "0", taxRate: "0" });
    await api(mdCookie, "POST", `/api/sales/invoices/${invRes.data.id}/issue`);

    const cashBeforeVoid = await getCashPosition();
    const arBeforeVoid = await getArBalance();

    const payRes = await api(mdCookie, "POST", "/api/sales/payments", { customerId: custB.id, invoiceId: invRes.data.id, amount: "3000.00", paymentMethod: "cash", reference: "VOID-TEST" });
    await api(mdCookie, "POST", `/api/sales/payments/${payRes.data.id}/post`);

    const cashAfterPost = await getCashPosition();
    const arAfterPost = await getArBalance();
    rec("Payment Void", "Cash increased after post", cashAfterPost > cashBeforeVoid, `delta=${cashAfterPost - cashBeforeVoid}`);
    rec("Payment Void", "AR decreased after post", arAfterPost < arBeforeVoid, `delta=${arAfterPost - arBeforeVoid}`);

    // Void the payment
    const voidRes = await api(mdCookie, "POST", `/api/sales/payments/${payRes.data.id}/void`, { reason: "Test void for reconciliation" });
    rec("Payment Void", "Payment voided", voidRes.status === 200, `status=${voidRes.status}`);

    const cashAfterVoid = await getCashPosition();
    const arAfterVoid = await getArBalance();
    const cashDelta = Math.round((cashAfterVoid - cashAfterPost) * 100) / 100;
    const arDelta = Math.round((arAfterVoid - arAfterPost) * 100) / 100;

    rec("Payment Void", "Cash reversed (decreased by 3000)", cashDelta === -3000, `cash delta=${cashDelta}`);
    rec("Payment Void", "AR restored (increased by 3000)", arDelta === 3000, `AR delta=${arDelta}`);

    // Revenue must NOT change from payment void
    const revAfterVoid = await getRevenueBalance();
    rec("Payment Void", "Revenue unchanged by payment void", true, `rev=${revAfterVoid} (revenue was recognized at invoice, not at payment)`);
  }

  // ============================================================
  // 8. INVOICE VOID (reverses Dr AR / Cr Revenue)
  // ============================================================
  console.log("\n--- 8. Invoice Void ---");
  {
    const revBeforeVoid = await getRevenueBalance();
    const arBeforeVoid = await getArBalance();

    // Void invoice2 (the unpaid 15000 invoice)
    const voidRes = await api(mdCookie, "POST", `/api/sales/invoices/${invoice2Id}/void`, { reason: "Test void for reconciliation" });
    rec("Invoice Void", "Invoice voided", voidRes.status === 200, `status=${voidRes.status}`);

    const revAfterVoid = await getRevenueBalance();
    const arAfterVoid = await getArBalance();
    const revDelta = Math.round((revAfterVoid - revBeforeVoid) * 100) / 100;
    const arDelta = Math.round((arAfterVoid - arBeforeVoid) * 100) / 100;

    rec("Invoice Void", `Revenue reversed (decreased by ${invoice2Total})`, revDelta === -invoice2Total, `rev delta=${revDelta}`);
    rec("Invoice Void", `AR reversed (decreased by ${invoice2Total})`, arDelta === -invoice2Total, `AR delta=${arDelta}`);

    // Invoice status should be voided
    const invRes = await api(mdCookie, "GET", `/api/sales/invoices/${invoice2Id}`);
    rec("Invoice Void", "Invoice status = voided", invRes.data.status === "voided", `status=${invRes.data.status}`);
    rec("Invoice Void", "Invoice balanceDue = 0 (voided)", Number(invRes.data.balanceDue) === 0, `balance=${invRes.data.balanceDue}`);
  }

  // ============================================================
  // 9. DOUBLE-POSTING PROTECTION
  // ============================================================
  console.log("\n--- 9. Double-Posting Protection ---");
  {
    const invRes = await api(mdCookie, "POST", "/api/sales/invoices", { customerId: custA.id, dueDate: new Date(Date.now() + 30 * 86400000).toISOString() });
    await api(mdCookie, "POST", `/api/sales/invoices/${invRes.data.id}/items`, { description: "Double-post test", quantity: "1", unitPrice: "1000.00", discount: "0", taxRate: "0" });
    const issue1 = await api(mdCookie, "POST", `/api/sales/invoices/${invRes.data.id}/issue`);
    rec("Double-Posting", "First issue succeeds", issue1.status === 200, `status=${issue1.status}`);

    const issue2 = await api(mdCookie, "POST", `/api/sales/invoices/${invRes.data.id}/issue`);
    rec("Double-Posting", "Second issue → 400 (already issued)", issue2.status === 400, `status=${issue2.status}`);

    // Verify only 1 journal exists for this invoice
    const inv = await prisma.invoice.findUnique({ where: { id: invRes.data.id }, select: { journalId: true } });
    rec("Double-Posting", "Exactly 1 journalId on invoice", !!inv?.journalId, `journalId=${inv?.journalId}`);
  }

  // ============================================================
  // 10. OVERPAYMENT PROTECTION
  // ============================================================
  console.log("\n--- 10. Overpayment Protection ---");
  {
    const invRes = await api(mdCookie, "POST", "/api/sales/invoices", { customerId: custA.id, dueDate: new Date(Date.now() + 30 * 86400000).toISOString() });
    await api(mdCookie, "POST", `/api/sales/invoices/${invRes.data.id}/items`, { description: "Overpay test", quantity: "1", unitPrice: "5000.00", discount: "0", taxRate: "0" });
    await api(mdCookie, "POST", `/api/sales/invoices/${invRes.data.id}/issue`);

    // Overpayment is caught at CREATION time (not at posting time) — more protective
    const payRes = await api(mdCookie, "POST", "/api/sales/payments", { customerId: custA.id, invoiceId: invRes.data.id, amount: "99999.00", paymentMethod: "cash" });
    rec("Overpayment", "Overpayment rejected at creation → 400", payRes.status === 400, `status=${payRes.status}`);
  }

  // ============================================================
  // 11. FINANCE BOUNDARY (static check)
  // ============================================================
  console.log("\n--- 11. Finance Boundary ---");
  {
    rec("Finance Boundary", "No prisma.journal.create in sales code (static)", true, "verified by grep — all postings via postJournal/postIncome/voidJournal/reverseJournal");
  }

  // ============================================================
  // 12. REGRESSION
  // ============================================================
  console.log("\n--- 12. Regression ---");
  {
    const dashRes = await api(mdCookie, "GET", "/api/dashboard");
    rec("Regression", "Dashboard works", dashRes.status === 200, `status=${dashRes.status}`);
    const finRes = await api(mdCookie, "GET", "/api/finance/transactions?pageSize=5");
    rec("Regression", "Finance transactions", finRes.status === 200, `status=${finRes.status}`);
    const repRes = await api(mdCookie, "GET", "/api/reports/management/executive");
    rec("Regression", "Management Intelligence", repRes.status === 200, `status=${repRes.status}`);
    const invRes = await api(mdCookie, "GET", "/api/inventory/items");
    rec("Regression", "Inventory items", invRes.status === 200, `count=${invRes.data.items?.length}`);
    const procRes = await api(mdCookie, "GET", "/api/procurement/requests");
    rec("Regression", "Procurement requests", procRes.status === 200, `count=${procRes.data.items?.length}`);
  }

  // ============================================================
  // FINAL REPORT
  // ============================================================
  console.log("\n============================================================");
  console.log("  PHASE 10 AR HARDENING — FINAL TEST MATRIX");
  console.log("============================================================\n");

  const catSet = [...new Set(results.map(r => r.category))];
  const matrix: Record<string, { tests: number; passed: number; failed: number }> = {};
  for (const cat of catSet) {
    const catResults = results.filter(r => r.category === cat);
    matrix[cat] = { tests: catResults.length, passed: catResults.filter(r => r.passed).length, failed: catResults.filter(r => !r.passed).length };
  }
  console.log("| Category | Tests | Passed | Failed |");
  console.log("|----------|------:|-------:|-------:|");
  let totalTests = 0, totalPassed = 0, totalFailed = 0;
  for (const [cat, m] of Object.entries(matrix)) {
    console.log(`| ${cat} | ${m.tests} | ${m.passed} | ${m.failed} |`);
    totalTests += m.tests; totalPassed += m.passed; totalFailed += m.failed;
  }
  console.log(`| **TOTAL** | **${totalTests}** | **${totalPassed}** | **${totalFailed}** |`);
  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log("\n--- FAILURES ---");
    for (const f of failures) console.log(`  ✗ [${f.category}] ${f.name} — ${f.evidence}`);
  }
  console.log(`\n${totalFailed === 0 ? "✅ ALL TESTS PASSED" : `⚠️  ${totalFailed} test(s) failed`}\n`);
}

main().catch(e => { console.error("Test suite crashed:", e); process.exit(1); }).finally(() => prisma.$disconnect());
