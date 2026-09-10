// ============================================================================
// LBMS Phase 9 — Management Intelligence Runtime Test Suite
// Run: bun run scripts/test-phase9.ts
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
  console.log("  LBMS PHASE 9 — MANAGEMENT INTELLIGENCE TEST SUITE");
  console.log("============================================================\n");

  const mdCookie = await login("md@phase7.test", PASSWORD);
  console.log("  ✓ Logged in as MD\n");

  // ============================================================
  // 1. MANAGEMENT SUMMARY (Executive)
  // ============================================================
  console.log("--- 1. Management Summary ---");
  {
    const res = await api(mdCookie, "GET", "/api/reports/management/executive?preset=month");
    rec("Management Summary", "Executive endpoint returns 200", res.status === 200, `status=${res.status}`);
    const d = res.data;
    rec("Management Summary", "period.label present", !!d.period?.label, `label=${d.period?.label}`);
    rec("Management Summary", "financial.totalRevenue is string", typeof d.financial?.totalRevenue === "string", `value=${d.financial?.totalRevenue}`);
    rec("Management Summary", "financial.totalExpenses is string", typeof d.financial?.totalExpenses === "string", `value=${d.financial?.totalExpenses}`);
    rec("Management Summary", "financial.netProfit is string", typeof d.financial?.netProfit === "string", `value=${d.financial?.netProfit}`);
    rec("Management Summary", "financial.cashPosition is string", typeof d.financial?.cashPosition === "string", `value=${d.financial?.cashPosition}`);
    rec("Management Summary", "AR/AP null (deferred)", d.financial?.accountsReceivable === null && d.financial?.accountsPayable === null, `AR=${d.financial?.accountsReceivable}, AP=${d.financial?.accountsPayable}`);
    rec("Management Summary", "projects.activeProjects is number", typeof d.projects?.activeProjects === "number", `value=${d.projects?.activeProjects}`);
    rec("Management Summary", "projects.actualProfit is string", typeof d.projects?.actualProfit === "string", `value=${d.projects?.actualProfit}`);
    rec("Management Summary", "operations.openTasks is number", typeof d.operations?.openTasks === "number", `value=${d.operations?.openTasks}`);
    rec("Management Summary", "operations.overdueTasks is number", typeof d.operations?.overdueTasks === "number", `value=${d.operations?.overdueTasks}`);
    rec("Management Summary", "workforce.totalEmployees is number", typeof d.workforce?.totalEmployees === "number", `value=${d.workforce?.totalEmployees}`);
    rec("Management Summary", "procurement.openPurchaseOrders is number", typeof d.procurement?.openPurchaseOrders === "number", `value=${d.procurement?.openPurchaseOrders}`);
    rec("Management Summary", "inventory.totalItems is number", typeof d.inventory?.totalItems === "number", `value=${d.inventory?.totalItems}`);
    rec("Management Summary", "inventory.lowStockItems is number", typeof d.inventory?.lowStockItems === "number", `value=${d.inventory?.lowStockItems}`);
  }

  // ============================================================
  // 2. DATE FILTERING
  // ============================================================
  console.log("\n--- 2. Date Filtering ---");
  for (const preset of ["today", "week", "month", "quarter", "year", "prev_month", "prev_quarter", "prev_year"]) {
    const res = await api(mdCookie, "GET", `/api/reports/management/executive?preset=${preset}`);
    rec("Date Filtering", `preset=${preset} returns 200`, res.status === 200, `status=${res.status}, label=${res.data?.period?.label}`);
  }
  // Custom range
  {
    const res = await api(mdCookie, "GET", "/api/reports/management/executive?preset=custom&from=2026-01-01&to=2026-12-31");
    rec("Date Filtering", "custom range returns 200", res.status === 200, `status=${res.status}, label=${res.data?.period?.label}`);
  }
  // Empty period (future dates with no transactions)
  {
    const res = await api(mdCookie, "GET", "/api/reports/management/executive?preset=custom&from=2030-01-01&to=2030-12-31");
    rec("Date Filtering", "empty period (future) returns 200 with zero values", res.status === 200 && Number(res.data.financial?.totalRevenue) === 0, `status=${res.status}, revenue=${res.data.financial?.totalRevenue}`);
  }

  // ============================================================
  // 3. FINANCE ANALYTICS
  // ============================================================
  console.log("\n--- 3. Finance Analytics ---");
  {
    const res = await api(mdCookie, "GET", "/api/reports/management/financial?preset=year");
    rec("Finance Analytics", "Financial endpoint returns 200", res.status === 200, `status=${res.status}`);
    const d = res.data;
    rec("Finance Analytics", "incomeByCategory is array", Array.isArray(d.incomeByCategory), `count=${d.incomeByCategory?.length}`);
    rec("Finance Analytics", "expenseByCategory is array", Array.isArray(d.expenseByCategory), `count=${d.expenseByCategory?.length}`);
    rec("Finance Analytics", "revenueByCustomer is array", Array.isArray(d.revenueByCustomer), `count=${d.revenueByCustomer?.length}`);
    rec("Finance Analytics", "expenseBySupplier is array", Array.isArray(d.expenseBySupplier), `count=${d.expenseBySupplier?.length}`);
    rec("Finance Analytics", "projectFinance is array", Array.isArray(d.projectFinance), `count=${d.projectFinance?.length}`);
    rec("Finance Analytics", "monthlyTrend is array (12 months)", Array.isArray(d.monthlyTrend) && d.monthlyTrend.length === 12, `count=${d.monthlyTrend?.length}`);

    // Verify finance correctness against direct DB calculation
    const summary = await api(mdCookie, "GET", "/api/finance/reports/summary?preset=year");
    rec("Finance Analytics", "Revenue matches finance reports", d.summary.totalRevenue === summary.data.totalIncome, `mgmt=${d.summary.totalRevenue}, finance=${summary.data.totalIncome}`);
    rec("Finance Analytics", "Expenses match finance reports", d.summary.totalExpenses === summary.data.totalExpenses, `mgmt=${d.summary.totalExpenses}, finance=${summary.data.totalExpenses}`);
  }

  // ============================================================
  // 4. CUSTOMER ANALYTICS
  // ============================================================
  console.log("\n--- 4. Customer Analytics ---");
  {
    const res = await api(mdCookie, "GET", "/api/reports/management/customers?preset=year");
    rec("Customer Analytics", "Customers endpoint returns 200", res.status === 200, `status=${res.status}`);
    const d = res.data;
    rec("Customer Analytics", "totals.totalCustomers is number", typeof d.totals?.totalCustomers === "number", `value=${d.totals?.totalCustomers}`);
    rec("Customer Analytics", "topCustomers is array", Array.isArray(d.topCustomers), `count=${d.topCustomers?.length}`);
    if (d.topCustomers?.length > 0) {
      const c = d.topCustomers[0];
      rec("Customer Analytics", "top customer has revenue field", typeof c.revenue === "string", `revenue=${c.revenue}`);
    }
    // Verify against DB
    const dbCustomerCount = await prisma.customer.count({ where: { deletedAt: null } });
    rec("Customer Analytics", "totalCustomers matches DB", d.totals?.totalCustomers === dbCustomerCount, `api=${d.totals?.totalCustomers}, db=${dbCustomerCount}`);
  }

  // ============================================================
  // 5. SUPPLIER ANALYTICS
  // ============================================================
  console.log("\n--- 5. Supplier Analytics ---");
  {
    const res = await api(mdCookie, "GET", "/api/reports/management/suppliers?preset=year");
    rec("Supplier Analytics", "Suppliers endpoint returns 200", res.status === 200, `status=${res.status}`);
    const d = res.data;
    rec("Supplier Analytics", "totals.totalSuppliers is number", typeof d.totals?.totalSuppliers === "number", `value=${d.totals?.totalSuppliers}`);
    rec("Supplier Analytics", "supplierAnalytics is array", Array.isArray(d.supplierAnalytics), `count=${d.supplierAnalytics?.length}`);
    const dbSupplierCount = await prisma.supplier.count({ where: { deletedAt: null } });
    rec("Supplier Analytics", "totalSuppliers matches DB", d.totals?.totalSuppliers === dbSupplierCount, `api=${d.totals?.totalSuppliers}, db=${dbSupplierCount}`);
  }

  // ============================================================
  // 6. PROJECT ANALYTICS
  // ============================================================
  console.log("\n--- 6. Project Analytics ---");
  {
    const res = await api(mdCookie, "GET", "/api/reports/management/projects?preset=year");
    rec("Project Analytics", "Projects endpoint returns 200", res.status === 200, `status=${res.status}`);
    const d = res.data;
    rec("Project Analytics", "statusDistribution is array", Array.isArray(d.statusDistribution), `count=${d.statusDistribution?.length}`);
    rec("Project Analytics", "topProfitable is array", Array.isArray(d.topProfitable), `count=${d.topProfitable?.length}`);
    rec("Project Analytics", "allProjects is array", Array.isArray(d.allProjects), `count=${d.allProjects?.length}`);
    rec("Project Analytics", "totals.totalProjects is number", typeof d.totals?.totalProjects === "number", `value=${d.totals?.totalProjects}`);
    rec("Project Analytics", "totals.totalProfit is string", typeof d.totals?.totalProfit === "string", `value=${d.totals?.totalProfit}`);
    // Verify against DB
    const dbProjectCount = await prisma.project.count({ where: { deletedAt: null } });
    rec("Project Analytics", "totalProjects matches DB", d.totals?.totalProjects === dbProjectCount, `api=${d.totals?.totalProjects}, db=${dbProjectCount}`);
  }

  // ============================================================
  // 7. PROCUREMENT ANALYTICS
  // ============================================================
  console.log("\n--- 7. Procurement Analytics ---");
  {
    const res = await api(mdCookie, "GET", "/api/reports/management/procurement?preset=year");
    rec("Procurement Analytics", "Procurement endpoint returns 200", res.status === 200, `status=${res.status}`);
    const d = res.data;
    rec("Procurement Analytics", "requestStatusDistribution is array", Array.isArray(d.requestStatusDistribution), `count=${d.requestStatusDistribution?.length}`);
    rec("Procurement Analytics", "poStatusDistribution is array", Array.isArray(d.poStatusDistribution), `count=${d.poStatusDistribution?.length}`);
    rec("Procurement Analytics", "topSuppliersByPOValue is array", Array.isArray(d.topSuppliersByPOValue), `count=${d.topSuppliersByPOValue?.length}`);
    rec("Procurement Analytics", "totals.poTotalValue is string", typeof d.totals?.poTotalValue === "string", `value=${d.totals?.poTotalValue}`);
  }

  // ============================================================
  // 8. INVENTORY ANALYTICS
  // ============================================================
  console.log("\n--- 8. Inventory Analytics ---");
  {
    const res = await api(mdCookie, "GET", "/api/reports/management/inventory?preset=year");
    rec("Inventory Analytics", "Inventory endpoint returns 200", res.status === 200, `status=${res.status}`);
    const d = res.data;
    rec("Inventory Analytics", "movementByType is array", Array.isArray(d.movementByType), `count=${d.movementByType?.length}`);
    rec("Inventory Analytics", "lowStockItems is array", Array.isArray(d.lowStockItems), `count=${d.lowStockItems?.length}`);
    rec("Inventory Analytics", "mostActiveItems is array", Array.isArray(d.mostActiveItems), `count=${d.mostActiveItems?.length}`);
    rec("Inventory Analytics", "totals.totalItems is number", typeof d.totals?.totalItems === "number", `value=${d.totals?.totalItems}`);
    // Verify against DB
    const dbItemCount = await prisma.inventoryItem.count({ where: { deletedAt: null } });
    rec("Inventory Analytics", "totalItems matches DB", d.totals?.totalItems === dbItemCount, `api=${d.totals?.totalItems}, db=${dbItemCount}`);
    // Verify balance = ledger (sample)
    const allBalances = await prisma.stockBalance.findMany({ select: { inventoryItemId: true, warehouseId: true, quantity: true } });
    let mismatches = 0;
    for (const b of allBalances) {
      const movements = await prisma.stockMovement.findMany({ where: { inventoryItemId: b.inventoryItemId, warehouseId: b.warehouseId }, select: { movementType: true, quantity: true } });
      let ledger = 0;
      for (const m of movements) {
        const qty = Number(m.quantity);
        if (["RECEIPT", "TRANSFER_IN", "ADJUSTMENT_IN"].includes(m.movementType)) ledger += qty;
        else if (["ISSUE", "TRANSFER_OUT", "ADJUSTMENT_OUT"].includes(m.movementType)) ledger -= qty;
      }
      if (Number(b.quantity) !== ledger) mismatches++;
    }
    rec("Inventory Analytics", "Balance = ledger (global integrity)", mismatches === 0, `mismatches=${mismatches}, balances=${allBalances.length}`);
  }

  // ============================================================
  // 9. OPERATIONS ANALYTICS
  // ============================================================
  console.log("\n--- 9. Operations Analytics ---");
  {
    const res = await api(mdCookie, "GET", "/api/reports/management/operations?preset=year");
    rec("Operations Analytics", "Operations endpoint returns 200", res.status === 200, `status=${res.status}`);
    const d = res.data;
    rec("Operations Analytics", "statusDistribution is array", Array.isArray(d.statusDistribution), `count=${d.statusDistribution?.length}`);
    rec("Operations Analytics", "tasksByProject is array", Array.isArray(d.tasksByProject), `count=${d.tasksByProject?.length}`);
    rec("Operations Analytics", "tasksByAssignee is array", Array.isArray(d.tasksByAssignee), `count=${d.tasksByAssignee?.length}`);
    rec("Operations Analytics", "totals.overdue is number", typeof d.totals?.overdue === "number", `value=${d.totals?.overdue}`);
    // Verify overdue against DB
    const now = new Date();
    const dbOverdue = await prisma.task.count({ where: { deletedAt: null, status: { in: ["todo", "in_progress", "on_hold"] }, dueDate: { lt: now } } });
    rec("Operations Analytics", "overdue matches DB", d.totals?.overdue === dbOverdue, `api=${d.totals?.overdue}, db=${dbOverdue}`);
  }

  // ============================================================
  // 10. HR ANALYTICS
  // ============================================================
  console.log("\n--- 10. HR Analytics ---");
  {
    const res = await api(mdCookie, "GET", "/api/reports/management/workforce?preset=year");
    rec("HR Analytics", "Workforce endpoint returns 200", res.status === 200, `status=${res.status}`);
    const d = res.data;
    rec("HR Analytics", "totals.totalEmployees is number", typeof d.totals?.totalEmployees === "number", `value=${d.totals?.totalEmployees}`);
    rec("HR Analytics", "employeesByDepartment is array", Array.isArray(d.employeesByDepartment), `count=${d.employeesByDepartment?.length}`);
    const dbEmpCount = await prisma.employee.count({ where: { deletedAt: null } });
    rec("HR Analytics", "totalEmployees matches DB", d.totals?.totalEmployees === dbEmpCount, `api=${d.totals?.totalEmployees}, db=${dbEmpCount}`);
  }

  // ============================================================
  // 11. RBAC
  // ============================================================
  console.log("\n--- 11. RBAC ---");
  const roleCookies: Record<string, string> = {};
  for (const role of ["md", "administrator", "finance_manager", "operations_manager", "hr_manager", "project_manager", "employee"]) {
    roleCookies[role] = await login(`${role}@phase7.test`, PASSWORD);
  }

  const rbacEndpoints = [
    { name: "executive", path: "/api/reports/management/executive" },
    { name: "financial", path: "/api/reports/management/financial" },
    { name: "customers", path: "/api/reports/management/customers" },
    { name: "suppliers", path: "/api/reports/management/suppliers" },
    { name: "projects", path: "/api/reports/management/projects" },
    { name: "procurement", path: "/api/reports/management/procurement" },
    { name: "inventory", path: "/api/reports/management/inventory" },
    { name: "operations", path: "/api/reports/management/operations" },
    { name: "workforce", path: "/api/reports/management/workforce" },
  ];

  // Expected access matrix (1=allow 200, 0=deny 403)
  // MD, Admin, FinMgr, OpsMgr, HR, PM, Employee
  // MD bypasses all; Admin/FinMgr/OpsMgr/HR have reports:view from seed; PM has reports:view; Employee does NOT
  const rbacMatrix: Record<string, number[]> = {
    md:                 [1,1,1,1,1,1,1,1,1],
    administrator:      [1,1,1,1,1,1,1,1,1],
    finance_manager:    [1,1,1,1,1,1,1,1,1],
    operations_manager: [1,1,1,1,1,1,1,1,1],
    hr_manager:         [1,1,1,1,1,1,1,1,1],
    project_manager:    [1,1,1,1,1,1,1,1,1],
    employee:           [0,0,0,0,0,0,0,0,0], // Employee has no reports:view
  };

  let rbacPassed = 0, rbacTotal = 0;
  const rbacFailures: string[] = [];
  for (const [role, expected] of Object.entries(rbacMatrix)) {
    for (let i = 0; i < rbacEndpoints.length; i++) {
      const ep = rbacEndpoints[i];
      const shouldAllow = expected[i] === 1;
      const res = await api(roleCookies[role], "GET", ep.path);
      rbacTotal++;
      const gotAuth = res.status === 200;
      const gotReject = res.status === 403;
      let pass: boolean;
      if (shouldAllow) pass = gotAuth;
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
    const res = await api("", "GET", "/api/reports/management/executive");
    rec("RBAC", "Unauthenticated → 401", res.status === 401, `status=${res.status}`);
  }

  // ============================================================
  // 12. IDOR / SECURITY
  // ============================================================
  console.log("\n--- 12. IDOR ---");
  {
    // Employee cannot access any report
    const res = await api(roleCookies["employee"], "GET", "/api/reports/management/executive");
    rec("IDOR", "Employee executive → 403", res.status === 403, `status=${res.status}`);
    // Invalid preset falls back to month (not an error)
    const res2 = await api(mdCookie, "GET", "/api/reports/management/executive?preset=invalid_preset");
    rec("IDOR", "Invalid preset → 200 (falls back to month)", res2.status === 200, `status=${res2.status}`);
    // Forged IDs in query params are ignored (analytics are aggregate, not per-record)
    const res3 = await api(mdCookie, "GET", "/api/reports/management/projects?projectId=forged");
    rec("IDOR", "Forged projectId param ignored (aggregate)", res3.status === 200, `status=${res3.status}`);
  }

  // ============================================================
  // 13. FINANCE BOUNDARY
  // ============================================================
  console.log("\n--- 13. Finance Boundary ---");
  {
    const journalBefore = await prisma.journal.count();
    // Hit all report endpoints
    for (const ep of rbacEndpoints) {
      await api(mdCookie, "GET", ep.path);
    }
    const journalAfter = await prisma.journal.count();
    rec("Finance Boundary", "No journals created by report reads", journalAfter === journalBefore, `before=${journalBefore}, after=${journalAfter}`);
  }

  // ============================================================
  // 14. READ-ONLY BOUNDARY
  // ============================================================
  console.log("\n--- 14. Read-Only Boundary ---");
  {
    // Verify no mutation endpoints exist (POST should return 405)
    const res = await api(mdCookie, "POST", "/api/reports/management/executive", {});
    rec("Read-Only", "POST to report endpoint → 405", res.status === 405, `status=${res.status}`);
    const res2 = await api(mdCookie, "DELETE", "/api/reports/management/executive");
    rec("Read-Only", "DELETE to report endpoint → 405", res2.status === 405, `status=${res2.status}`);
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
    const finRepRes = await api(mdCookie, "GET", "/api/finance/reports/summary");
    rec("Finance Regression", "Finance reports summary", finRepRes.status === 200, `status=${finRepRes.status}`);
    const staffRes = await api(mdCookie, "GET", "/api/staff");
    rec("HR Regression", "Staff directory", staffRes.status === 200, `count=${staffRes.data.items?.length}`);
    const custRes = await api(mdCookie, "GET", "/api/customers");
    rec("CRM Regression", "Customers", custRes.status === 200, `count=${custRes.data.items?.length}`);
    const supRes = await api(mdCookie, "GET", "/api/suppliers");
    rec("CRM Regression", "Suppliers", supRes.status === 200, `count=${supRes.data.items?.length}`);
    const projRes = await api(mdCookie, "GET", "/api/projects");
    rec("Project Regression", "Projects", projRes.status === 200, `count=${projRes.data.items?.length}`);
    const taskRes = await api(mdCookie, "GET", "/api/tasks");
    rec("Operations Regression", "Tasks", taskRes.status === 200, `count=${taskRes.data.items?.length}`);
    const procRes = await api(mdCookie, "GET", "/api/procurement/requests");
    rec("Procurement Regression", "Requests", procRes.status === 200, `count=${procRes.data.items?.length}`);
    const poRes = await api(mdCookie, "GET", "/api/procurement/orders");
    rec("Procurement Regression", "Purchase orders", poRes.status === 200, `count=${poRes.data.items?.length}`);
    const invRes = await api(mdCookie, "GET", "/api/inventory/items");
    rec("Inventory Regression", "Inventory items", invRes.status === 200, `count=${invRes.data.items?.length}`);
    // Auth
    for (const role of ["md", "administrator", "finance_manager", "operations_manager", "hr_manager", "project_manager", "employee"]) {
      const r = await api(roleCookies[role], "GET", "/api/dashboard");
      rec("Auth Regression", `${role} dashboard access`, r.status === 200, `status=${r.status}`);
    }
  }

  // ============================================================
  // FINAL REPORT
  // ============================================================
  console.log("\n============================================================");
  console.log("  PHASE 9 — FINAL TEST MATRIX");
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
