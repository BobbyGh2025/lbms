// ============================================================================
// LBMS Phase 10 — Sales, Quotations, Invoicing & Receivables Test Suite
// Run: bun run scripts/test-phase10.ts
// ============================================================================
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE = "http://localhost:3000";
const PASSWORD = "TestPass123!";

interface R { category: string; name: string; passed: boolean; evidence: string; }
const results: R[] = [];
function rec(category: string, name: string, passed: boolean, evidence: string) {
  results.push({ category, name, passed, evidence });
  console.log(`  ${passed ? "✓" : "✗"} ${name} — ${evidence}`);
}

async function login(email: string, password: string): Promise<string> {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { method: "GET" });
  const csrfToken = (await csrfRes.json()).csrfToken;
  const csrfCookies = (csrfRes as any).headers.getSetCookie?.() || [csrfRes.headers.get("set-cookie") || ""];
  const csrfCookieStr = csrfCookies.map((c: string) => c.split(";")[0]).join("; ");
  const body = new URLSearchParams({ email, password, csrfToken, callbackUrl: "/", json: "true" });
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookieStr }, body, redirect: "manual",
  });
  const loginCookies = (loginRes as any).headers.getSetCookie?.() || [loginRes.headers.get("set-cookie") || ""];
  const allCookies = loginCookies.map((c: string) => c.split(";")[0]).join("; ");
  if (!allCookies.includes("session-token")) throw new Error(`Login failed for ${email}`);
  return allCookies;
}

async function api(cookie: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { Cookie: cookie };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function main() {
  console.log("\n============================================================");
  console.log("  LBMS PHASE 10 — SALES, QUOTATIONS, INVOICING & RECEIVABLES");
  console.log("============================================================\n");

  const mdCookie = await login("md@phase7.test", PASSWORD);
  console.log("  ✓ Logged in as MD\n");

  // Reference data
  const [custRes, projRes, invItemsRes] = await Promise.all([
    api(mdCookie, "GET", "/api/customers?pageSize=100"),
    api(mdCookie, "GET", "/api/projects?pageSize=100"),
    api(mdCookie, "GET", "/api/inventory/items?pageSize=100"),
  ]);
  const customers = custRes.data.items || [];
  const projects = projRes.data.items || [];
  const invItems = invItemsRes.data.items || [];
  const firstCustomer = customers[0];
  const secondCustomer = customers[1] || customers[0];
  const firstProject = projects.find((p: any) => p.status === "active") || projects[0];
  const firstInvItem = invItems[0];
  console.log(`  Refs: ${customers.length} customers, ${projects.length} projects, ${invItems.length} inv items\n`);

  // ============================================================
  // 1. QUOTATIONS CRUD
  // ============================================================
  console.log("--- 1. Quotations CRUD ---");
  let createdQuoteId = "";
  {
    const res = await api(mdCookie, "POST", "/api/sales/quotes", { customerId: firstCustomer.id, projectId: firstProject?.id, expiryDate: new Date(Date.now() + 30 * 86400000).toISOString(), notes: "Test quote" });
    createdQuoteId = res.data.id || "";
    rec("Quotations", "Create quote", res.status === 201 && /^QT-\d{4}-\d{6}$/.test(res.data.quoteNumber || ""), `status=${res.status}, num=${res.data.quoteNumber}`);
  }
  {
    const res = await api(mdCookie, "GET", "/api/sales/quotes?page=1&pageSize=20");
    rec("Quotations", "List quotes", res.status === 200 && Array.isArray(res.data.items) && res.data.items.length > 0, `count=${res.data.items?.length}`);
  }
  {
    const res = await api(mdCookie, "GET", `/api/sales/quotes/${createdQuoteId}`);
    rec("Quotations", "Get single quote", res.status === 200 && res.data.id === createdQuoteId, `status=${res.status}`);
  }
  {
    const res = await api(mdCookie, "PATCH", `/api/sales/quotes/${createdQuoteId}`, { notes: "Updated notes" });
    rec("Quotations", "Update draft quote", res.status === 200 && res.data.notes === "Updated notes", `status=${res.status}`);
  }
  {
    const res = await api(mdCookie, "POST", "/api/sales/quotes", { notes: "Missing customer" });
    rec("Quotations", "Create missing customerId → 400", res.status === 400, `status=${res.status}`);
  }
  {
    const res = await api(mdCookie, "POST", "/api/sales/quotes", { customerId: "nonexistent-customer" });
    rec("Quotations", "Create invalid customer → 400", res.status === 400, `status=${res.status}`);
  }

  // ============================================================
  // 2. QUOTE LIFECYCLE
  // ============================================================
  console.log("\n--- 2. Quote Lifecycle ---");
  {
    // Add item while still draft (items can only be added to draft)
    await api(mdCookie, "POST", `/api/sales/quotes/${createdQuoteId}/items`, { description: "Lifecycle test item", quantity: "5", unitPrice: "100.00", discount: "0", taxRate: "0" });
    // draft → sent
    const r1 = await api(mdCookie, "POST", `/api/sales/quotes/${createdQuoteId}/send`);
    rec("Quote Lifecycle", "draft → sent", r1.status === 200 && r1.data.status === "sent", `status=${r1.status}`);
    // sent → accepted
    const r2 = await api(mdCookie, "POST", `/api/sales/quotes/${createdQuoteId}/accept`);
    rec("Quote Lifecycle", "sent → accepted", r2.status === 200 && r2.data.status === "accepted", `status=${r2.status}`);
    // accepted → sent (invalid)
    const r3 = await api(mdCookie, "POST", `/api/sales/quotes/${createdQuoteId}/send`);
    rec("Quote Lifecycle", "accepted → sent (invalid) → 400", r3.status === 400, `status=${r3.status}`);
    // PATCH on accepted (terminal-ish) — should be blocked
    const r4 = await api(mdCookie, "PATCH", `/api/sales/quotes/${createdQuoteId}`, { notes: "try edit after accept" });
    rec("Quote Lifecycle", "PATCH accepted quote → 400", r4.status === 400, `status=${r4.status}`);
  }

  // ============================================================
  // 3. QUOTE → ORDER CONVERSION
  // ============================================================
  console.log("\n--- 3. Quote → Order Conversion ---");
  {
    // The quote from section 1 (createdQuoteId) is already accepted + has items.
    // Convert accepted quote to order
    const r1 = await api(mdCookie, "POST", `/api/sales/quotes/${createdQuoteId}/convert`);
    rec("Quote→Order", "Convert accepted quote → order", r1.status === 201 || r1.status === 200, `status=${r1.status}, orderNum=${r1.data.orderNumber}`);
    // Verify quote is now "converted"
    const qRes = await api(mdCookie, "GET", `/api/sales/quotes/${createdQuoteId}`);
    rec("Quote→Order", "Quote status → converted", qRes.data.status === "converted", `status=${qRes.data.status}`);
    // Try convert again (idempotent — should return existing order, not create duplicate)
    const r2 = await api(mdCookie, "POST", `/api/sales/quotes/${createdQuoteId}/convert`);
    rec("Quote→Order", "Double conversion → idempotent", r2.status === 200, `status=${r2.status}`);
    // Verify only 1 order exists for this quote
    const orderCount = await prisma.salesOrder.count({ where: { quoteId: createdQuoteId } });
    rec("Quote→Order", "Exactly 1 order per quote", orderCount === 1, `orderCount=${orderCount}`);
    // Try converting a draft quote (should fail)
    const draftQuoteRes = await api(mdCookie, "POST", "/api/sales/quotes", { customerId: firstCustomer.id });
    const r3 = await api(mdCookie, "POST", `/api/sales/quotes/${draftQuoteRes.data.id}/convert`);
    rec("Quote→Order", "Convert draft quote → 400", r3.status === 400, `status=${r3.status}`);
  }

  // ============================================================
  // 4. SALES ORDERS CRUD
  // ============================================================
  console.log("\n--- 4. Sales Orders CRUD ---");
  let createdOrderId = "";
  {
    const res = await api(mdCookie, "POST", "/api/sales/orders", { customerId: firstCustomer.id, projectId: firstProject?.id, notes: "Test order" });
    createdOrderId = res.data.id || "";
    rec("Sales Orders", "Create order", res.status === 201 && /^SO-\d{4}-\d{6}$/.test(res.data.orderNumber || ""), `status=${res.status}, num=${res.data.orderNumber}`);
  }
  {
    const res = await api(mdCookie, "GET", "/api/sales/orders?page=1&pageSize=20");
    rec("Sales Orders", "List orders", res.status === 200 && Array.isArray(res.data.items), `count=${res.data.items?.length}`);
  }
  {
    const res = await api(mdCookie, "GET", `/api/sales/orders/${createdOrderId}`);
    rec("Sales Orders", "Get single order", res.status === 200 && res.data.id === createdOrderId, `status=${res.status}`);
  }

  // ============================================================
  // 5. ORDER LIFECYCLE
  // ============================================================
  console.log("\n--- 5. Order Lifecycle ---");
  {
    const r1 = await api(mdCookie, "POST", `/api/sales/orders/${createdOrderId}/confirm`);
    rec("Order Lifecycle", "draft → confirmed", r1.status === 200 && r1.data.status === "confirmed", `status=${r1.status}`);
    const r2 = await api(mdCookie, "POST", `/api/sales/orders/${createdOrderId}/complete`);
    rec("Order Lifecycle", "confirmed → completed", r2.status === 200 && r2.data.status === "completed", `status=${r2.status}`);
    const r3 = await api(mdCookie, "POST", `/api/sales/orders/${createdOrderId}/confirm`);
    rec("Order Lifecycle", "completed → confirmed (invalid) → 400", r3.status === 400, `status=${r3.status}`);
  }

  // ============================================================
  // 6. INVOICES CRUD
  // ============================================================
  console.log("\n--- 6. Invoices CRUD ---");
  let createdInvoiceId = "";
  {
    const res = await api(mdCookie, "POST", "/api/sales/invoices", { customerId: firstCustomer.id, dueDate: new Date(Date.now() + 30 * 86400000).toISOString(), notes: "Test invoice" });
    createdInvoiceId = res.data.id || "";
    rec("Invoices", "Create invoice", res.status === 201 && /^INV-\d{4}-\d{6}$/.test(res.data.invoiceNumber || ""), `status=${res.status}, num=${res.data.invoiceNumber}`);
  }
  {
    const res = await api(mdCookie, "GET", "/api/sales/invoices?page=1&pageSize=20");
    rec("Invoices", "List invoices", res.status === 200 && Array.isArray(res.data.items), `count=${res.data.items?.length}`);
  }
  {
    const res = await api(mdCookie, "GET", `/api/sales/invoices/${createdInvoiceId}`);
    rec("Invoices", "Get single invoice", res.status === 200 && res.data.id === createdInvoiceId, `status=${res.status}`);
  }

  // ============================================================
  // 7. INVOICE CALCULATIONS (server-side totals)
  // ============================================================
  console.log("\n--- 7. Invoice Calculations ---");
  {
    // Add item to the draft invoice
    const itemRes = await api(mdCookie, "POST", `/api/sales/invoices/${createdInvoiceId}/items`, { description: "Test item", quantity: "10", unitPrice: "500.00", discount: "0", taxRate: "15" });
    rec("Invoice Calculations", "Add item (10 × 500 = 5000, tax 15% = 750, total = 5750)", itemRes.status === 201, `status=${itemRes.status}`);
    // Verify totals
    const invRes = await api(mdCookie, "GET", `/api/sales/invoices/${createdInvoiceId}`);
    rec("Invoice Calculations", "Subtotal = 5000", Number(invRes.data.subtotal) === 5000, `subtotal=${invRes.data.subtotal}`);
    rec("Invoice Calculations", "Tax = 750", Number(invRes.data.tax) === 750, `tax=${invRes.data.tax}`);
    rec("Invoice Calculations", "Total = 5750", Number(invRes.data.total) === 5750, `total=${invRes.data.total}`);
    rec("Invoice Calculations", "BalanceDue = 5750 (unpaid)", Number(invRes.data.balanceDue) === 5750, `balance=${invRes.data.balanceDue}`);
  }

  // ============================================================
  // 8. INVOICE LIFECYCLE
  // ============================================================
  console.log("\n--- 8. Invoice Lifecycle ---");
  {
    // draft → issued
    const r1 = await api(mdCookie, "POST", `/api/sales/invoices/${createdInvoiceId}/issue`);
    rec("Invoice Lifecycle", "draft → issued", r1.status === 200 && r1.data.status === "issued", `status=${r1.status}`);
    // issued → draft (invalid)
    const r2 = await api(mdCookie, "POST", `/api/sales/invoices/${createdInvoiceId}/issue`);
    rec("Invoice Lifecycle", "issued → issued (invalid) → 400", r2.status === 400, `status=${r2.status}`);
    // PATCH on issued (should be blocked)
    const r3 = await api(mdCookie, "PATCH", `/api/sales/invoices/${createdInvoiceId}`, { notes: "try edit after issue" });
    rec("Invoice Lifecycle", "PATCH issued invoice → 400", r3.status === 400, `status=${r3.status}`);
  }

  // ============================================================
  // 9. PAYMENTS + RECEIVABLES
  // ============================================================
  console.log("\n--- 9. Payments & Receivables ---");
  let createdPaymentId = "";
  {
    // Create payment for the issued invoice
    const res = await api(mdCookie, "POST", "/api/sales/payments", { customerId: firstCustomer.id, invoiceId: createdInvoiceId, amount: "2000.00", paymentMethod: "bank_transfer", reference: "TEST-PMT-001" });
    createdPaymentId = res.data.id || "";
    rec("Payments", "Create payment (2000 of 5750)", res.status === 201 && /^PMT-\d{4}-\d{6}$/.test(res.data.paymentNumber || ""), `status=${res.status}, num=${res.data.paymentNumber}`);
  }
  // Overpayment protection
  {
    const res = await api(mdCookie, "POST", "/api/sales/payments", { customerId: firstCustomer.id, invoiceId: createdInvoiceId, amount: "9999999.00", paymentMethod: "cash" });
    rec("Payments", "Overpayment → 400", res.status === 400, `status=${res.status}`);
  }
  // Post the payment (triggers finance posting)
  {
    const r = await api(mdCookie, "POST", `/api/sales/payments/${createdPaymentId}/post`);
    rec("Payments", "Post payment (draft → posted)", r.status === 200 && r.data.payment?.status === "posted", `status=${r.status}, payment.status=${r.data.payment?.status}`);
    // Verify invoice balance updated
    const invRes = await api(mdCookie, "GET", `/api/sales/invoices/${createdInvoiceId}`);
    rec("Payments", "Invoice amountPaid = 2000", Number(invRes.data.amountPaid) === 2000, `paid=${invRes.data.amountPaid}`);
    rec("Payments", "Invoice balanceDue = 3750", Number(invRes.data.balanceDue) === 3750, `balance=${invRes.data.balanceDue}`);
    rec("Payments", "Invoice status = partially_paid", invRes.data.status === "partially_paid", `status=${invRes.data.status}`);
  }

  // ============================================================
  // 10. RECEIVABLES DASHBOARD
  // ============================================================
  console.log("\n--- 10. Receivables Dashboard ---");
  {
    const res = await api(mdCookie, "GET", "/api/sales/receivables");
    rec("Receivables", "Receivables endpoint returns 200", res.status === 200, `status=${res.status}`);
    rec("Receivables", "summary.totalOutstanding is string", typeof res.data.summary?.totalOutstanding === "string", `value=${res.data.summary?.totalOutstanding}`);
    rec("Receivables", "summary.outstandingCount is number", typeof res.data.summary?.outstandingCount === "number", `value=${res.data.summary?.outstandingCount}`);
    rec("Receivables", "aging buckets present", !!res.data.aging, `aging keys=${res.data.aging ? Object.keys(res.data.aging).join(",") : "none"}`);
    rec("Receivables", "customerBreakdown array present", Array.isArray(res.data.customerBreakdown), `count=${res.data.customerBreakdown?.length}`);
  }

  // ============================================================
  // 11. FINANCE BOUNDARY
  // ============================================================
  console.log("\n--- 11. Finance Boundary ---");
  {
    const journalCountBefore = await prisma.journal.count();
    // Post another payment (triggers postIncome)
    const payRes = await api(mdCookie, "POST", "/api/sales/payments", { customerId: firstCustomer.id, invoiceId: createdInvoiceId, amount: "1000.00", paymentMethod: "cash" });
    await api(mdCookie, "POST", `/api/sales/payments/${payRes.data.id}/post`);
    const journalCountAfter = await prisma.journal.count();
    rec("Finance Boundary", "Payment posting creates exactly 1 journal", journalCountAfter === journalCountBefore + 1, `before=${journalCountBefore}, after=${journalCountAfter}`);
    // Verify the journal is a posted income journal linked to the customer
    const lastJournal = await prisma.journal.findFirst({ orderBy: { createdAt: "desc" }, select: { transactionType: true, status: true, customerId: true } });
    rec("Finance Boundary", "Journal is posted income with customerId", lastJournal?.transactionType === "income" && lastJournal?.status === "posted" && !!lastJournal?.customerId, `type=${lastJournal?.transactionType}, status=${lastJournal?.status}, customerId=${lastJournal?.customerId}`);
  }

  // ============================================================
  // 12. RBAC (7 roles × 9 endpoints = 63 probes)
  // ============================================================
  console.log("\n--- 12. RBAC ---");
  const roleCookies: Record<string, string> = {};
  for (const role of ["md", "administrator", "finance_manager", "operations_manager", "hr_manager", "project_manager", "employee"]) {
    roleCookies[role] = await login(`${role}@phase7.test`, PASSWORD);
  }
  const rbacEndpoints = [
    { name: "list quotes", method: "GET", path: "/api/sales/quotes" },
    { name: "create quote", method: "POST", path: "/api/sales/quotes", body: { customerId: firstCustomer.id } },
    { name: "list orders", method: "GET", path: "/api/sales/orders" },
    { name: "list invoices", method: "GET", path: "/api/sales/invoices" },
    { name: "list payments", method: "GET", path: "/api/sales/payments" },
    { name: "receivables", method: "GET", path: "/api/sales/receivables" },
    { name: "create invoice", method: "POST", path: "/api/sales/invoices", body: { customerId: firstCustomer.id, dueDate: new Date(Date.now() + 86400000).toISOString() } },
    { name: "create payment", method: "POST", path: "/api/sales/payments", body: { customerId: firstCustomer.id, amount: "100.00" } },
    { name: "convert quote", method: "POST", path: `/api/sales/quotes/${createdQuoteId}/convert` },
  ];
  // Expected: 1=allow, 0=deny(403)
  // MD bypasses; Admin/FinMgr = all; OpsMgr = view/create/edit/submit/issue but NOT approve/pay/void; PM = view/create/edit/submit/issue; Employee = view only; HR = none
  const rbacMatrix: Record<string, number[]> = {
    md:                 [1,1,1,1,1,1,1,1,1],
    administrator:      [1,1,1,1,1,1,1,1,1],
    finance_manager:    [1,1,1,1,1,1,1,1,1],
    operations_manager: [1,1,1,1,1,1,1,0,1], // no pay perm
    hr_manager:         [0,0,0,0,0,0,0,0,0], // no sales access
    project_manager:    [1,1,1,1,1,1,1,0,1], // no pay perm
    employee:           [1,0,1,1,1,1,0,0,0], // view only — receivables uses sales:view which employee has
  };
  let rbacPassed = 0, rbacTotal = 0;
  const rbacFailures: string[] = [];
  for (const [role, expected] of Object.entries(rbacMatrix)) {
    for (let i = 0; i < rbacEndpoints.length; i++) {
      const ep = rbacEndpoints[i];
      const shouldAllow = expected[i] === 1;
      const res = await api(roleCookies[role], ep.method, ep.path, ep.body);
      rbacTotal++;
      const gotAuth = res.status === 200 || res.status === 201;
      const gotReject = res.status === 403;
      const gotOtherError = res.status === 400 || res.status === 404;
      let pass: boolean;
      if (shouldAllow) pass = gotAuth || gotOtherError;
      else pass = gotReject;
      if (pass) rbacPassed++;
      else rbacFailures.push(`${role}→${ep.name}: expected ${shouldAllow ? "allow" : "deny(403)"}, got ${res.status}`);
    }
  }
  rec("RBAC", `7 roles × 9 endpoints (${rbacTotal} probes)`, rbacPassed === rbacTotal, `${rbacPassed}/${rbacTotal} passed`);
  if (rbacFailures.length > 0) {
    for (const f of rbacFailures.slice(0, 5)) rec("RBAC", f, false, "");
  }
  // Unauthenticated
  {
    const res = await api("", "GET", "/api/sales/quotes");
    rec("RBAC", "Unauthenticated → 401", res.status === 401, `status=${res.status}`);
  }

  // ============================================================
  // 13. IDOR / SECURITY
  // ============================================================
  console.log("\n--- 13. IDOR ---");
  {
    const res = await api(mdCookie, "GET", "/api/sales/quotes/nonexistent-id");
    rec("IDOR", "Nonexistent quote → 404", res.status === 404, `status=${res.status}`);
    const res2 = await api(mdCookie, "GET", "/api/sales/invoices/nonexistent-id");
    rec("IDOR", "Nonexistent invoice → 404", res2.status === 404, `status=${res2.status}`);
    const res3 = await api(mdCookie, "POST", `/api/sales/quotes/nonexistent-id/send`);
    rec("IDOR", "Send nonexistent quote → 404", res3.status === 404, `status=${res3.status}`);
    // HR Manager cannot access sales
    const res4 = await api(roleCookies["hr_manager"], "GET", "/api/sales/quotes");
    rec("IDOR", "HR Manager sales access → 403", res4.status === 403, `status=${res4.status}`);
    // Employee cannot create
    const res5 = await api(roleCookies["employee"], "POST", "/api/sales/quotes", { customerId: firstCustomer.id });
    rec("IDOR", "Employee create quote → 403", res5.status === 403, `status=${res5.status}`);
  }

  // ============================================================
  // 14. CONCURRENCY (invoice numbering)
  // ============================================================
  console.log("\n--- 14. Concurrency ---");
  {
    const promises: Promise<any>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(api(mdCookie, "POST", "/api/sales/invoices", { customerId: firstCustomer.id, dueDate: new Date(Date.now() + 86400000).toISOString() }));
    }
    const responses = await Promise.all(promises);
    const successes = responses.filter(r => r.status === 201);
    const numbers = successes.map(r => r.data.invoiceNumber);
    const unique = new Set(numbers);
    rec("Concurrency", "10 concurrent invoice creates — unique numbers", unique.size === successes.length, `successes=${successes.length}, unique=${unique.size}`);
    const dupInDb = await prisma.invoice.groupBy({ by: ["invoiceNumber"], _count: true, having: { invoiceNumber: { _count: { gt: 1 } } } });
    rec("Concurrency", "No duplicate invoice numbers in DB", dupInDb.length === 0, `dupes=${dupInDb.length}`);
  }

  // ============================================================
  // 15. REGRESSION
  // ============================================================
  console.log("\n--- 15. Regression ---");
  {
    const dashRes = await api(mdCookie, "GET", "/api/dashboard");
    rec("Finance Regression", "Dashboard works", dashRes.status === 200, `status=${dashRes.status}`);
    const finRes = await api(mdCookie, "GET", "/api/finance/transactions?pageSize=5");
    rec("Finance Regression", "Finance transactions", finRes.status === 200, `status=${finRes.status}`);
    const staffRes = await api(mdCookie, "GET", "/api/staff");
    rec("HR Regression", "Staff directory", staffRes.status === 200, `count=${staffRes.data.items?.length}`);
    const custRes = await api(mdCookie, "GET", "/api/customers");
    rec("CRM Regression", "Customers", custRes.status === 200, `count=${custRes.data.items?.length}`);
    const projRes = await api(mdCookie, "GET", "/api/projects");
    rec("Project Regression", "Projects", projRes.status === 200, `count=${projRes.data.items?.length}`);
    const taskRes = await api(mdCookie, "GET", "/api/tasks");
    rec("Operations Regression", "Tasks", taskRes.status === 200, `count=${taskRes.data.items?.length}`);
    const procRes = await api(mdCookie, "GET", "/api/procurement/requests");
    rec("Procurement Regression", "Requests", procRes.status === 200, `count=${procRes.data.items?.length}`);
    const invRes = await api(mdCookie, "GET", "/api/inventory/items");
    rec("Inventory Regression", "Inventory items", invRes.status === 200, `count=${invRes.data.items?.length}`);
    const repRes = await api(mdCookie, "GET", "/api/reports/management/executive");
    rec("Mgmt Intelligence Regression", "Executive report", repRes.status === 200, `status=${repRes.status}`);
    for (const role of ["md", "administrator", "finance_manager", "operations_manager", "hr_manager", "project_manager", "employee"]) {
      const r = await api(roleCookies[role], "GET", "/api/dashboard");
      rec("Auth Regression", `${role} dashboard access`, r.status === 200, `status=${r.status}`);
    }
  }

  // ============================================================
  // FINAL REPORT
  // ============================================================
  console.log("\n============================================================");
  console.log("  PHASE 10 — FINAL TEST MATRIX");
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
