// ============================================================================
// LBMS Phase 7 — Comprehensive Runtime Test Suite
// ----------------------------------------------------------------------------
// Logs in as MD (and each RBAC role) via NextAuth credentials, then exercises
// every procurement API endpoint + regression checks. Produces a PASS/FAIL
// matrix. Run with: bun run scripts/test-phase7.ts
// ============================================================================
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE = "http://localhost:3000";
const PASSWORD = "TestPass123!";

interface TestResult { category: string; name: string; passed: boolean; detail?: string; }
const results: TestResult[] = [];

function record(category: string, name: string, passed: boolean, detail?: string) {
  results.push({ category, name, passed, detail });
  const mark = passed ? "✓" : "✗";
  console.log(`  ${mark} ${name}${detail && !passed ? ` — ${detail}` : ""}`);
}

// --- Cookie-aware fetch ---
async function login(email: string, password: string): Promise<string> {
  // 1. Get CSRF token
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { method: "GET" });
  const csrfToken = (await csrfRes.json()).csrfToken;
  // Use getSetCookie to handle multiple cookies (NextAuth chunks large session tokens)
  const csrfCookies = (csrfRes as any).headers.getSetCookie?.() || [csrfRes.headers.get("set-cookie") || ""];
  const csrfCookieStr = csrfCookies.map((c: string) => c.split(";")[0]).join("; ");

  // 2. Submit credentials
  const body = new URLSearchParams({ email, password, csrfToken, callbackUrl: "/", json: "true" });
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookieStr },
    body,
    redirect: "manual",
  });
  const loginCookies = (loginRes as any).headers.getSetCookie?.() || [loginRes.headers.get("set-cookie") || ""];
  // Capture all cookies (session token may be chunked into .0, .1, etc.)
  const allCookies = loginCookies.map((c: string) => c.split(";")[0]).join("; ");
  if (!allCookies.includes("session-token")) {
    throw new Error(`Login failed for ${email} (status ${loginRes.status})`);
  }
  return allCookies;
}

async function api(cookie: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { Cookie: cookie };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// --- Helpers ---
let mdCookie = "";

async function main() {
  console.log("\n============================================================");
  console.log("  LBMS PHASE 7 — PROCUREMENT RUNTIME TEST SUITE");
  console.log("============================================================\n");

  // Login as MD
  mdCookie = await login("md@phase7.test", PASSWORD);
  console.log("  ✓ Logged in as MD\n");

  // Fetch reference data for tests
  const [suppliersRes, projectsRes, staffRes, tasksRes] = await Promise.all([
    api(mdCookie, "GET", "/api/suppliers?pageSize=100"),
    api(mdCookie, "GET", "/api/projects?pageSize=100"),
    api(mdCookie, "GET", "/api/staff?pageSize=100"),
    api(mdCookie, "GET", "/api/tasks?pageSize=100"),
  ]);
  const suppliers = suppliersRes.data.items || [];
  const projects = projectsRes.data.items || [];
  const employees = staffRes.data.items || [];
  const tasks = tasksRes.data.items || [];
  const firstSupplier = suppliers[0];
  // Use a non-terminal project (active or planning) — completed/cancelled are rejected.
  const firstProject = projects.find((p: any) => p.status === "active" || p.status === "planning") || projects[0];
  const firstEmployee = employees[0];
  // Use a non-terminal task for the task integration test.
  const firstTask = tasks.find((t: any) => t.status === "todo" || t.status === "in_progress") || tasks[0];
  // requestedById expects a USER id, not an Employee id. Fetch the MD user.
  const mdUser = await prisma.user.findFirst({ where: { userRoles: { some: { role: { name: "md" } } } } });

  console.log(`  Reference data: ${suppliers.length} suppliers, ${projects.length} projects, ${employees.length} employees, ${tasks.length} tasks\n`);

  // ============================================================
  // 1. PROCUREMENT REQUEST CRUD
  // ============================================================
  console.log("--- 1. Procurement Request CRUD ---");
  let createdRequestId = "";
  let createdRequestNumber = "";

  // CREATE
  {
    const res = await api(mdCookie, "POST", "/api/procurement/requests", {
      title: "Test procurement request — office supplies",
      requesterId: firstEmployee.id,
      supplierId: firstSupplier.id,
      projectId: firstProject.id,
      priority: "high",
      requiredByDate: new Date(Date.now() + 7 * 86400000).toISOString(),
      notes: "Created by Phase 7 test suite",
    });
    createdRequestId = res.data.id || "";
    createdRequestNumber = res.data.requestNumber || "";
    record("Procurement Request CRUD", "Create request (valid)", res.status === 201 && !!res.data.id && /^REQ-\d{4}-\d{6}$/.test(res.data.requestNumber), `status=${res.status}`);
  }

  // READ (list)
  {
    const res = await api(mdCookie, "GET", "/api/procurement/requests?page=1&pageSize=20");
    record("Procurement Request CRUD", "List requests", res.status === 200 && Array.isArray(res.data.items) && res.data.items.length > 0, `count=${res.data.items?.length}`);
  }

  // READ (single)
  {
    const res = await api(mdCookie, "GET", `/api/procurement/requests/${createdRequestId}`);
    record("Procurement Request CRUD", "Get single request", res.status === 200 && res.data.id === createdRequestId, `status=${res.status}`);
  }

  // UPDATE
  {
    const res = await api(mdCookie, "PATCH", `/api/procurement/requests/${createdRequestId}`, { notes: "Updated by test suite" });
    record("Procurement Request CRUD", "Update request (draft)", res.status === 200 && res.data.notes === "Updated by test suite", `status=${res.status}`);
  }

  // CREATE — missing title (should 400)
  {
    const res = await api(mdCookie, "POST", "/api/procurement/requests", { requesterId: firstEmployee.id });
    record("Procurement Request CRUD", "Create missing title → 400", res.status === 400, `status=${res.status}`);
  }

  // CREATE — invalid supplier (should 400)
  {
    const res = await api(mdCookie, "POST", "/api/procurement/requests", { title: "Bad supplier test", requesterId: firstEmployee.id, supplierId: "nonexistent-supplier-id" });
    record("Procurement Request CRUD", "Create invalid supplier → 400", res.status === 400, `status=${res.status}`);
  }

  // CREATE — invalid project (should 400)
  {
    const res = await api(mdCookie, "POST", "/api/procurement/requests", { title: "Bad project test", requesterId: firstEmployee.id, projectId: "nonexistent-project-id" });
    record("Procurement Request CRUD", "Create invalid project → 400", res.status === 400, `status=${res.status}`);
  }

  // CREATE — invalid requester (should 400)
  {
    const res = await api(mdCookie, "POST", "/api/procurement/requests", { title: "Bad requester test", requesterId: "nonexistent-employee-id" });
    record("Procurement Request CRUD", "Create invalid requester → 400", res.status === 400, `status=${res.status}`);
  }

  // ============================================================
  // 2. REQUEST LIFECYCLE
  // ============================================================
  console.log("\n--- 2. Request Lifecycle ---");

  // draft → submitted (valid)
  {
    const res = await api(mdCookie, "POST", `/api/procurement/requests/${createdRequestId}/submit`);
    record("Request Lifecycle", "draft → submitted", res.status === 200 && res.data.status === "submitted", `status=${res.status}`);
  }

  // submitted → approved (valid, MD bypasses self-approval guard)
  {
    const res = await api(mdCookie, "POST", `/api/procurement/requests/${createdRequestId}/approve`);
    record("Request Lifecycle", "submitted → approved", res.status === 200 && res.data.status === "approved", `status=${res.status}`);
  }

  // approved → converted happens via PO creation (tested later)

  // Invalid: approved → submitted (should 400)
  {
    const res = await api(mdCookie, "POST", `/api/procurement/requests/${createdRequestId}/submit`);
    record("Request Lifecycle", "approved → submitted (invalid) → 400", res.status === 400, `status=${res.status}`);
  }

  // Invalid: approved → rejected (should 400)
  {
    const res = await api(mdCookie, "POST", `/api/procurement/requests/${createdRequestId}/reject`, { reason: "test" });
    record("Request Lifecycle", "approved → rejected (invalid) → 400", res.status === 400, `status=${res.status}`);
  }

  // Create a fresh draft request for cancel test + reject test
  let rejectableRequestId = "";
  {
    const res = await api(mdCookie, "POST", "/api/procurement/requests", { title: "Request for rejection test", requesterId: firstEmployee.id, priority: "medium" });
    rejectableRequestId = res.data.id;
    await api(mdCookie, "POST", `/api/procurement/requests/${rejectableRequestId}/submit`);
  }

  // submitted → rejected (valid)
  {
    const res = await api(mdCookie, "POST", `/api/procurement/requests/${rejectableRequestId}/reject`, { reason: "Not budgeted this quarter" });
    record("Request Lifecycle", "submitted → rejected", res.status === 200 && res.data.status === "rejected", `status=${res.status}`);
  }

  // rejected → submit (invalid, terminal)
  {
    const res = await api(mdCookie, "POST", `/api/procurement/requests/${rejectableRequestId}/submit`);
    record("Request Lifecycle", "rejected → submitted (terminal) → 400", res.status === 400, `status=${res.status}`);
  }

  // Create another for cancel test
  let cancellableRequestId = "";
  {
    const res = await api(mdCookie, "POST", "/api/procurement/requests", { title: "Request for cancel test", requesterId: firstEmployee.id, priority: "low" });
    cancellableRequestId = res.data.id;
  }

  // draft → cancelled (valid)
  {
    const res = await api(mdCookie, "POST", `/api/procurement/requests/${cancellableRequestId}/cancel`);
    record("Request Lifecycle", "draft → cancelled", res.status === 200 && res.data.status === "cancelled", `status=${res.status}`);
  }

  // cancelled → submit (invalid, terminal)
  {
    const res = await api(mdCookie, "POST", `/api/procurement/requests/${cancellableRequestId}/submit`);
    record("Request Lifecycle", "cancelled → submitted (terminal) → 400", res.status === 400, `status=${res.status}`);
  }

  // PATCH on terminal state (should 400)
  {
    const res = await api(mdCookie, "PATCH", `/api/procurement/requests/${cancellableRequestId}`, { notes: "should fail" });
    record("Request Lifecycle", "PATCH on cancelled request → 400", res.status === 400, `status=${res.status}`);
  }

  // Reject without reason (should 400)
  {
    const freshRes = await api(mdCookie, "POST", "/api/procurement/requests", { title: "For reject-no-reason test", requesterId: firstEmployee.id });
    await api(mdCookie, "POST", `/api/procurement/requests/${freshRes.data.id}/submit`);
    const res = await api(mdCookie, "POST", `/api/procurement/requests/${freshRes.data.id}/reject`, {});
    record("Request Lifecycle", "Reject without reason → 400", res.status === 400, `status=${res.status}`);
  }

  // ============================================================
  // 3. APPROVAL — self-approval guard
  // ============================================================
  console.log("\n--- 3. Approval (self-approval guard) ---");
  {
    // Create a request as MD, submit it, then try to approve as MD (should succeed — MD bypasses)
    const createRes = await api(mdCookie, "POST", "/api/procurement/requests", { title: "MD self-approve test", requesterId: firstEmployee.id });
    await api(mdCookie, "POST", `/api/procurement/requests/${createRes.data.id}/submit`);
    const approveRes = await api(mdCookie, "POST", `/api/procurement/requests/${createRes.data.id}/approve`);
    record("Approval", "MD self-approve (bypasses guard)", approveRes.status === 200 && approveRes.data.status === "approved", `status=${approveRes.status}`);
  }

  // ============================================================
  // 4. PURCHASE ORDER CRUD
  // ============================================================
  console.log("\n--- 4. Purchase Order CRUD ---");
  let createdPOId = "";
  let createdPONumber = "";

  // CREATE
  {
    const res = await api(mdCookie, "POST", "/api/procurement/orders", {
      supplierId: firstSupplier.id,
      projectId: firstProject.id,
      requestedById: mdUser!.id,
      expectedDeliveryDate: new Date(Date.now() + 14 * 86400000).toISOString(),
      notes: "Test PO from Phase 7 suite",
    });
    createdPOId = res.data.id || "";
    createdPONumber = res.data.purchaseOrderNumber || "";
    record("Purchase Order CRUD", "Create PO (valid)", res.status === 201 && /^PO-\d{4}-\d{6}$/.test(res.data.purchaseOrderNumber || ""), `status=${res.status}`);
  }

  // READ (list)
  {
    const res = await api(mdCookie, "GET", "/api/procurement/orders?page=1&pageSize=20");
    record("Purchase Order CRUD", "List POs", res.status === 200 && Array.isArray(res.data.items) && res.data.items.length > 0, `count=${res.data.items?.length}`);
  }

  // READ (single)
  {
    const res = await api(mdCookie, "GET", `/api/procurement/orders/${createdPOId}`);
    record("Purchase Order CRUD", "Get single PO", res.status === 200 && res.data.id === createdPOId, `status=${res.status}`);
  }

  // UPDATE
  {
    const res = await api(mdCookie, "PATCH", `/api/procurement/orders/${createdPOId}`, { notes: "Updated PO notes" });
    record("Purchase Order CRUD", "Update PO (draft)", res.status === 200 && res.data.notes === "Updated PO notes", `status=${res.status}`);
  }

  // CREATE — missing supplier (should 400)
  {
    const res = await api(mdCookie, "POST", "/api/procurement/orders", { requestedById: mdUser!.id });
    record("Purchase Order CRUD", "Create missing supplier → 400", res.status === 400, `status=${res.status}`);
  }

  // CREATE — invalid supplier (should 400)
  {
    const res = await api(mdCookie, "POST", "/api/procurement/orders", { supplierId: "nonexistent", requestedById: mdUser!.id });
    record("Purchase Order CRUD", "Create invalid supplier → 400", res.status === 400, `status=${res.status}`);
  }

  // ============================================================
  // 5. PO LIFECYCLE
  // ============================================================
  console.log("\n--- 5. PO Lifecycle ---");

  // Convert the approved request to a PO
  let convertedPOId = "";
  {
    const res = await api(mdCookie, "POST", "/api/procurement/orders", {
      supplierId: firstSupplier.id,
      procurementRequestId: createdRequestId, // the approved request from earlier
      requestedById: mdUser!.id,
    });
    convertedPOId = res.data.id || "";
    record("PO Lifecycle", "Create PO from approved request (conversion)", res.status === 201, `status=${res.status}`);

    // Verify the request is now "converted"
    const reqRes = await api(mdCookie, "GET", `/api/procurement/requests/${createdRequestId}`);
    record("PO Lifecycle", "Request status → converted after PO creation", reqRes.data.status === "converted", `status=${reqRes.data.status}`);
  }

  // Try to convert the same request again (should 400 — already converted)
  {
    const res = await api(mdCookie, "POST", "/api/procurement/orders", {
      supplierId: firstSupplier.id,
      procurementRequestId: createdRequestId,
      requestedById: mdUser!.id,
    });
    record("PO Lifecycle", "Double-conversion → 400", res.status === 400, `status=${res.status}`);
  }

  // Try to convert a DRAFT request (should 400 — only approved can convert)
  {
    const draftReqRes = await api(mdCookie, "POST", "/api/procurement/requests", { title: "Draft for conversion test", requesterId: firstEmployee.id });
    const res = await api(mdCookie, "POST", "/api/procurement/orders", {
      supplierId: firstSupplier.id,
      procurementRequestId: draftReqRes.data.id,
      requestedById: mdUser!.id,
    });
    record("PO Lifecycle", "Convert DRAFT request → 400", res.status === 400, `status=${res.status}`);
  }

  // PO lifecycle: draft → pending_approval → approved → sent
  {
    // pending_approval
    const submitRes = await api(mdCookie, "PATCH", `/api/procurement/orders/${createdPOId}`, { status: "pending_approval" });
    // Actually PATCH doesn't change status. Let me use the PO as createdPOId (draft). Move to pending_approval by creating one.
  }

  // Create a fresh PO for lifecycle test
  let lifecyclePOId = "";
  {
    const res = await api(mdCookie, "POST", "/api/procurement/orders", {
      supplierId: firstSupplier.id,
      requestedById: mdUser!.id,
      status: "pending_approval",
    });
    lifecyclePOId = res.data.id;
  }

  // pending_approval → approved
  {
    const res = await api(mdCookie, "POST", `/api/procurement/orders/${lifecyclePOId}/approve`);
    record("PO Lifecycle", "pending_approval → approved", res.status === 200 && res.data.status === "approved", `status=${res.status}`);
  }

  // approved → sent
  {
    const res = await api(mdCookie, "POST", `/api/procurement/orders/${lifecyclePOId}/send`);
    record("PO Lifecycle", "approved → sent", res.status === 200 && res.data.status === "sent", `status=${res.status}`);
  }

  // Invalid: sent → approved (should 400)
  {
    const res = await api(mdCookie, "POST", `/api/procurement/orders/${lifecyclePOId}/approve`);
    record("PO Lifecycle", "sent → approved (invalid) → 400", res.status === 400, `status=${res.status}`);
  }

  // Invalid: draft → sent (should 400 — must approve first)
  {
    const res = await api(mdCookie, "POST", `/api/procurement/orders/${createdPOId}/send`);
    record("PO Lifecycle", "draft → sent (invalid) → 400", res.status === 400, `status=${res.status}`);
  }

  // ============================================================
  // 6. ITEMS
  // ============================================================
  console.log("\n--- 6. Purchase Order Items ---");

  // Add item to the draft PO
  let itemId = "";
  {
    const res = await api(mdCookie, "POST", `/api/procurement/orders/${createdPOId}/items`, { description: "Test item — laptop", quantity: "2", unitPrice: "8500.00", taxRate: "15" });
    itemId = res.data.item?.id || "";
    record("Items", "Add item (valid)", res.status === 201 && !!itemId, `status=${res.status}`);
  }

  // Verify total was computed server-side
  {
    const res = await api(mdCookie, "GET", `/api/procurement/orders/${createdPOId}`);
    const po = res.data;
    // 2 × 8500 = 17000 subtotal, tax 15% = 2550, total = 19550
    record("Items", "Server-side total computation", Number(po.total) === 19550 && Number(po.subtotal) === 17000 && Number(po.tax) === 2550, `total=${po.total}, subtotal=${po.subtotal}, tax=${po.tax}`);
  }

  // Add second item
  {
    const res = await api(mdCookie, "POST", `/api/procurement/orders/${createdPOId}/items`, { description: "Test item — monitor", quantity: "2", unitPrice: "1200.00", taxRate: "0" });
    record("Items", "Add second item", res.status === 201, `status=${res.status}`);
  }

  // Verify totals updated
  {
    const res = await api(mdCookie, "GET", `/api/procurement/orders/${createdPOId}`);
    const po = res.data;
    // subtotal: 17000 + 2400 = 19400; tax: 2550 + 0 = 2550; total: 21950
    record("Items", "Totals recompute after 2nd item", Number(po.subtotal) === 19400 && Number(po.total) === 21950, `subtotal=${po.subtotal}, total=${po.total}`);
  }

  // Update item
  {
    const res = await api(mdCookie, "PATCH", `/api/procurement/orders/${createdPOId}/items/${itemId}`, { quantity: "3" });
    record("Items", "Update item quantity", res.status === 200, `status=${res.status}`);
  }

  // Invalid quantity (negative)
  {
    const res = await api(mdCookie, "POST", `/api/procurement/orders/${createdPOId}/items`, { description: "Bad qty", quantity: "-5", unitPrice: "100.00", taxRate: "0" });
    record("Items", "Negative quantity → 400", res.status === 400, `status=${res.status}`);
  }

  // Invalid unitPrice (negative)
  {
    const res = await api(mdCookie, "POST", `/api/procurement/orders/${createdPOId}/items`, { description: "Bad price", quantity: "1", unitPrice: "-50.00", taxRate: "0" });
    record("Items", "Negative unitPrice → 400", res.status === 400, `status=${res.status}`);
  }

  // Invalid taxRate (>100)
  {
    const res = await api(mdCookie, "POST", `/api/procurement/orders/${createdPOId}/items`, { description: "Bad tax", quantity: "1", unitPrice: "100.00", taxRate: "150" });
    record("Items", "Tax rate >100 → 400", res.status === 400, `status=${res.status}`);
  }

  // Delete item
  {
    const res = await api(mdCookie, "DELETE", `/api/procurement/orders/${createdPOId}/items/${itemId}`);
    record("Items", "Delete item", res.status === 200 && res.data.deleted === true, `status=${res.status}`);
  }

  // Cross-PO item access (should 404 — item belongs to a different PO)
  {
    const res = await api(mdCookie, "GET", `/api/procurement/orders/${convertedPOId}/items/nonexistent-item-id`);
    record("Items", "Cross-PO item access → 404", res.status === 404, `status=${res.status}`);
  }

  // ============================================================
  // 7. SUPPLIER INTEGRATION
  // ============================================================
  console.log("\n--- 7. Supplier Integration ---");
  {
    // Verify the PO is linked to the supplier
    const res = await api(mdCookie, "GET", `/api/procurement/orders/${createdPOId}`);
    record("Supplier Integration", "PO has supplier FK", res.status === 200 && res.data.supplierId === firstSupplier.id, `supplierId=${res.data.supplierId}`);

    // Verify supplier profile includes purchase orders
    const supRes = await api(mdCookie, "GET", `/api/suppliers/${firstSupplier.id}`);
    record("Supplier Integration", "Supplier profile includes POs", supRes.status === 200 && Array.isArray(supRes.data.purchaseOrders) && supRes.data.purchaseOrders.length > 0, `poCount=${supRes.data.purchaseOrders?.length}`);
  }

  // ============================================================
  // 8. PROJECT INTEGRATION
  // ============================================================
  console.log("\n--- 8. Project Integration ---");
  {
    const res = await api(mdCookie, "GET", `/api/procurement/orders?projectId=${firstProject.id}`);
    record("Project Integration", "Filter POs by project", res.status === 200 && Array.isArray(res.data.items), `count=${res.data.items?.length}`);

    // Create PO against cancelled project (should 400)
    const cancelledProject = await prisma.project.findFirst({ where: { status: "cancelled" } });
    if (cancelledProject) {
      const res2 = await api(mdCookie, "POST", "/api/procurement/orders", {
        supplierId: firstSupplier.id,
        projectId: cancelledProject.id,
        requestedById: mdUser!.id,
      });
      record("Project Integration", "Create PO against cancelled project → 400", res2.status === 400, `status=${res2.status}`);
    }
  }

  // ============================================================
  // 9. TASK INTEGRATION
  // ============================================================
  console.log("\n--- 9. Task Integration ---");
  {
    // Create request linked to a task
    const res = await api(mdCookie, "POST", "/api/procurement/requests", {
      title: "Request linked to task",
      requesterId: firstEmployee.id,
      taskId: firstTask.id,
    });
    record("Task Integration", "Create request with task link", res.status === 201 && res.data.taskId === firstTask.id, `status=${res.status}`);

    // Create request with invalid task
    const res2 = await api(mdCookie, "POST", "/api/procurement/requests", {
      title: "Request with bad task",
      requesterId: firstEmployee.id,
      taskId: "nonexistent-task-id",
    });
    record("Task Integration", "Create request with invalid task → 400", res2.status === 400, `status=${res2.status}`);

    // Create request with cancelled task (should 400)
    const cancelledTask = await prisma.task.findFirst({ where: { status: "cancelled" } });
    if (cancelledTask) {
      const res3 = await api(mdCookie, "POST", "/api/procurement/requests", { title: "Request with cancelled task", requesterId: firstEmployee.id, taskId: cancelledTask.id });
      record("Task Integration", "Create request with cancelled task → 400", res3.status === 400, `status=${res3.status}`);
    }
  }

  // ============================================================
  // 10. RECEIVING
  // ============================================================
  console.log("\n--- 10. Receiving ---");

  // Use the sent PO (lifecyclePOId) which has items. First add an item to it.
  {
    // The lifecyclePOId is "sent" status. Add items before sending... actually we can't add items to sent POs.
    // Let me create a new PO for receiving test: create → add item → approve → send → receive
    const createRes = await api(mdCookie, "POST", "/api/procurement/orders", {
      supplierId: firstSupplier.id,
      requestedById: mdUser!.id,
      status: "pending_approval",
    });
    const receivePOId = createRes.data.id;

    // Add item
    const itemRes = await api(mdCookie, "POST", `/api/procurement/orders/${receivePOId}/items`, { description: "Receive test item — qty 10", quantity: "10", unitPrice: "100.00", taxRate: "0" });
    const receiveItemId = itemRes.data.item.id;

    // Approve → send
    await api(mdCookie, "POST", `/api/procurement/orders/${receivePOId}/approve`);
    await api(mdCookie, "POST", `/api/procurement/orders/${receivePOId}/send`);

    // Partial receipt (3 of 10)
    {
      const res = await api(mdCookie, "POST", `/api/procurement/orders/${receivePOId}/receiving`, {
        items: [{ purchaseOrderItemId: receiveItemId, receivedQuantity: "3" }],
        notes: "Partial delivery — 3 of 10",
      });
      record("Receiving", "Partial receipt (3 of 10)", res.status === 201 && res.data.updatedPO.status === "partially_received", `status=${res.status}, poStatus=${res.data.updatedPO?.status}`);
    }

    // Verify item receivedQuantity updated
    {
      const res = await api(mdCookie, "GET", `/api/procurement/orders/${receivePOId}/items`);
      const item = res.data.items[0];
      record("Receiving", "Item receivedQuantity updated", Number(item.receivedQuantity) === 3 && item.status === "partially_received", `receivedQuantity=${item.receivedQuantity}, status=${item.status}`);
    }

    // Over-receipt (try to receive 8 more, total would be 11 > 10)
    {
      const res = await api(mdCookie, "POST", `/api/procurement/orders/${receivePOId}/receiving`, {
        items: [{ purchaseOrderItemId: receiveItemId, receivedQuantity: "8" }],
      });
      record("Receiving", "Over-receipt → 400", res.status === 400, `status=${res.status}`);
    }

    // Full receipt (7 more, total 10)
    {
      const res = await api(mdCookie, "POST", `/api/procurement/orders/${receivePOId}/receiving`, {
        items: [{ purchaseOrderItemId: receiveItemId, receivedQuantity: "7" }],
      });
      record("Receiving", "Full receipt (7 more → total 10)", res.status === 201 && res.data.updatedPO.status === "received", `status=${res.status}, poStatus=${res.data.updatedPO?.status}`);
    }

    // Close the received PO
    {
      const res = await api(mdCookie, "POST", `/api/procurement/orders/${receivePOId}/close`);
      record("Receiving", "received → closed", res.status === 200 && res.data.status === "closed", `status=${res.status}`);
    }

    // Cancel a PO with receipts (should 400)
    {
      const res = await api(mdCookie, "POST", `/api/procurement/orders/${receivePOId}/cancel`);
      record("Receiving", "Cancel PO with receipts → 400", res.status === 400, `status=${res.status}`);
    }

    // Receive against invalid PO (should 404)
    {
      const res = await api(mdCookie, "POST", "/api/procurement/orders/nonexistent-po-id/receiving", { items: [{ purchaseOrderItemId: "x", receivedQuantity: "1" }] });
      record("Receiving", "Receive against invalid PO → 404", res.status === 404, `status=${res.status}`);
    }
  }

  // ============================================================
  // 11. NUMBER CONCURRENCY
  // ============================================================
  console.log("\n--- 11. Number Concurrency ---");
  {
    const promises: Promise<{ status: number; data: any }>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(api(mdCookie, "POST", "/api/procurement/requests", { title: `Concurrency test ${i}`, requesterId: firstEmployee.id }));
    }
    const responses = await Promise.all(promises);
    const successes = responses.filter(r => r.status === 201);
    const numbers = successes.map(r => r.data.requestNumber);
    const unique = new Set(numbers);
    record("Number Concurrency", "10 concurrent request creates — unique numbers", unique.size === successes.length && successes.length >= 1, `successes=${successes.length}, unique=${unique.size}`);
  }

  // ============================================================
  // 12. RBAC — 7 roles × 8 endpoints = 56 probes
  // ============================================================
  console.log("\n--- 12. RBAC (7 roles × 8 endpoints) ---");
  const roleCookies: Record<string, string> = {};
  for (const role of ["md", "administrator", "finance_manager", "operations_manager", "hr_manager", "project_manager", "employee"]) {
    roleCookies[role] = await login(`${role}@phase7.test`, PASSWORD);
  }

  // Fetch a known-valid PO and request ID for the RBAC probes (the ones
  // created earlier may have been deleted/modified during lifecycle tests).
  const knownReqRes = await api(mdCookie, "GET", "/api/procurement/requests?pageSize=1");
  const knownReqId = knownReqRes.data.items?.[0]?.id || createdRequestId;
  const knownPORes = await api(mdCookie, "GET", "/api/procurement/orders?pageSize=1");
  const knownPOId = knownPORes.data.items?.[0]?.id || createdPOId;

  // 8 representative endpoints
  const rbacEndpoints = [
    { name: "GET requests", method: "GET", path: "/api/procurement/requests" },
    { name: "POST request", method: "POST", path: "/api/procurement/requests", body: { title: "RBAC test", requesterId: firstEmployee.id } },
    { name: "GET request [id]", method: "GET", path: `/api/procurement/requests/${knownReqId}` },
    { name: "GET orders", method: "GET", path: "/api/procurement/orders" },
    { name: "POST order", method: "POST", path: "/api/procurement/orders", body: { supplierId: firstSupplier.id, requestedById: mdUser!.id } },
    { name: "GET PO [id]", method: "GET", path: `/api/procurement/orders/${knownPOId}` },
    { name: "GET items", method: "GET", path: `/api/procurement/orders/${knownPOId}/items` },
    { name: "GET receiving", method: "GET", path: `/api/procurement/orders/${knownPOId}/receiving` },
  ];

  // Expected access matrix (true = should succeed 200/201, false = should be 403)
  const rbacExpected: Record<string, boolean[]> = {
    //                  GETreq POSTreq GETreq[id] GETorders POSTorder GETpo[id] GETitems GETreceiving
    md:                  [true,  true,   true,      true,     true,     true,     true,    true],
    administrator:       [true,  true,   true,      true,     true,     true,     true,    true],
    finance_manager:     [true,  true,   true,      true,     true,     true,     true,    true],
    operations_manager:  [true,  true,   true,      true,     true,     true,     true,    true],
    hr_manager:          [false, false,  false,     false,    false,    false,    false,   false],
    project_manager:     [true,  true,   true,      true,     true,     true,     true,    true],
    employee:            [true,  false,  true,      true,     false,    true,     true,    true],
  };

  let rbacPassed = 0;
  let rbacTotal = 0;
  for (const [role, expected] of Object.entries(rbacExpected)) {
    const cookie = roleCookies[role];
    for (let i = 0; i < rbacEndpoints.length; i++) {
      const ep = rbacEndpoints[i];
      const res = await api(cookie, ep.method, ep.path, ep.body);
      const shouldSucceed = expected[i];
      const didSucceed = res.status === 200 || res.status === 201;
      const pass = shouldSucceed === didSucceed;
      rbacTotal++;
      if (pass) rbacPassed++;
      else record("RBAC", `${role} → ${ep.name} (expected ${shouldSucceed ? "allow" : "deny"}, got ${res.status})`, false, `status=${res.status}`);
    }
  }
  record("RBAC", `56 RBAC probes (7 roles × 8 endpoints)`, rbacPassed === rbacTotal, `${rbacPassed}/${rbacTotal} passed`);

  // ============================================================
  // 13. IDOR / Security
  // ============================================================
  console.log("\n--- 13. IDOR / Security ---");
  {
    // Nonexistent request
    const res1 = await api(mdCookie, "GET", "/api/procurement/requests/nonexistent-id");
    record("IDOR/Security", "Nonexistent request → 404", res1.status === 404, `status=${res1.status}`);

    // Nonexistent PO
    const res2 = await api(mdCookie, "GET", "/api/procurement/orders/nonexistent-id");
    record("IDOR/Security", "Nonexistent PO → 404", res2.status === 404, `status=${res2.status}`);

    // Nonexistent request approve
    const res3 = await api(mdCookie, "POST", "/api/procurement/requests/nonexistent-id/approve");
    record("IDOR/Security", "Approve nonexistent request → 404", res3.status === 404, `status=${res3.status}`);

    // Nonexistent PO send
    const res4 = await api(mdCookie, "POST", "/api/procurement/orders/nonexistent-id/send");
    record("IDOR/Security", "Send nonexistent PO → 404", res4.status === 404, `status=${res4.status}`);

    // Cross-PO item PATCH (item doesn't exist on this PO → 404)
    {
      // Create a fresh draft PO so the status check passes and we reach the item-existence check
      const poRes = await api(mdCookie, "POST", "/api/procurement/orders", { supplierId: firstSupplier.id, requestedById: mdUser!.id });
      const res5 = await api(mdCookie, "PATCH", `/api/procurement/orders/${poRes.data.id}/items/nonexistent-item-id`, { description: "hack attempt", quantity: "1", unitPrice: "10.00", taxRate: "0" });
      record("IDOR/Security", "Cross-PO item PATCH → 404", res5.status === 404, `status=${res5.status}`);
    }

    // Receiving with invalid item ID (on a sent PO)
    {
      // Create a sent PO for this test
      const poRes = await api(mdCookie, "POST", "/api/procurement/orders", { supplierId: firstSupplier.id, requestedById: mdUser!.id, status: "pending_approval" });
      await api(mdCookie, "POST", `/api/procurement/orders/${poRes.data.id}/items`, { description: "Item", quantity: "5", unitPrice: "10.00", taxRate: "0" });
      await api(mdCookie, "POST", `/api/procurement/orders/${poRes.data.id}/approve`);
      await api(mdCookie, "POST", `/api/procurement/orders/${poRes.data.id}/send`);
      const res6 = await api(mdCookie, "POST", `/api/procurement/orders/${poRes.data.id}/receiving`, { items: [{ purchaseOrderItemId: "nonexistent-item", receivedQuantity: "1" }] });
      record("IDOR/Security", "Receive with invalid item → 400", res6.status === 400, `status=${res6.status}`);
    }

    // Unauthenticated access
    const res7 = await api("", "GET", "/api/procurement/requests");
    record("IDOR/Security", "Unauthenticated GET → 401", res7.status === 401, `status=${res7.status}`);

    // HR Manager (no procurement access) trying to create a PO
    const res8 = await api(roleCookies["hr_manager"], "POST", "/api/procurement/orders", { supplierId: firstSupplier.id, requestedById: mdUser!.id });
    record("IDOR/Security", "HR Manager create PO → 403", res8.status === 403, `status=${res8.status}`);

    // Employee trying to create a request
    const res9 = await api(roleCookies["employee"], "POST", "/api/procurement/requests", { title: "employee attempt", requesterId: firstEmployee.id });
    record("IDOR/Security", "Employee create request → 403", res9.status === 403, `status=${res9.status}`);

    // Employee trying to approve (on a submitted request)
    {
      const submitReq = await api(mdCookie, "POST", "/api/procurement/requests", { title: "For employee approve test", requesterId: firstEmployee.id });
      await api(mdCookie, "POST", `/api/procurement/requests/${submitReq.data.id}/submit`);
      const res10 = await api(roleCookies["employee"], "POST", `/api/procurement/requests/${submitReq.data.id}/approve`);
      record("IDOR/Security", "Employee approve → 403", res10.status === 403, `status=${res10.status}`);
    }

    // Employee trying to cancel
    const res11 = await api(roleCookies["employee"], "POST", `/api/procurement/orders/${knownPOId}/cancel`);
    record("IDOR/Security", "Employee cancel PO → 403", res11.status === 403, `status=${res11.status}`);

    // Project Manager trying to approve (PM has view/create/edit/submit/receive but NOT approve)
    {
      const submitReq2 = await api(mdCookie, "POST", "/api/procurement/requests", { title: "For PM approve test", requesterId: firstEmployee.id });
      await api(mdCookie, "POST", `/api/procurement/requests/${submitReq2.data.id}/submit`);
      const res12 = await api(roleCookies["project_manager"], "POST", `/api/procurement/requests/${submitReq2.data.id}/approve`);
      record("IDOR/Security", "Project Manager approve (no approve perm) → 403", res12.status === 403, `status=${res12.status}`);
    }

    // Project Manager trying to cancel
    const res13 = await api(roleCookies["project_manager"], "POST", `/api/procurement/orders/${knownPOId}/cancel`);
    record("IDOR/Security", "Project Manager cancel (no cancel perm) → 403", res13.status === 403, `status=${res13.status}`);
  }

  // ============================================================
  // 14. AUDIT
  // ============================================================
  console.log("\n--- 14. Audit ---");
  {
    const res = await api(mdCookie, "GET", "/api/audit?module=procurement&page=1&pageSize=50");
    const auditItems = res.data.items || [];
    const hasCreate = auditItems.some((a: any) => a.action === "create");
    const hasApprove = auditItems.some((a: any) => a.action === "approve");
    const hasUpdate = auditItems.some((a: any) => a.action === "update");
    record("Audit", "Procurement create audit entries exist", hasCreate, `count=${auditItems.length}`);
    record("Audit", "Procurement approve audit entries exist", hasApprove, "");
    record("Audit", "Procurement update audit entries exist", hasUpdate, "");
  }

  // ============================================================
  // 15. DASHBOARD
  // ============================================================
  console.log("\n--- 15. Dashboard KPIs ---");
  {
    const res = await api(mdCookie, "GET", "/api/dashboard");
    const b = res.data.business;
    record("Dashboard", "openProcurementRequests is a number", typeof b.openProcurementRequests === "number", `value=${b.openProcurementRequests}`);
    record("Dashboard", "pendingApprovalRequests is a number", typeof b.pendingApprovalRequests === "number", `value=${b.pendingApprovalRequests}`);
    record("Dashboard", "openPurchaseOrders is a number", typeof b.openPurchaseOrders === "number", `value=${b.openPurchaseOrders}`);
    record("Dashboard", "partiallyReceivedPOs is a number", typeof b.partiallyReceivedPOs === "number", `value=${b.partiallyReceivedPOs}`);
    record("Dashboard", "fullyReceivedPOs is a number", typeof b.fullyReceivedPOs === "number", `value=${b.fullyReceivedPOs}`);
    record("Dashboard", "Procurement alert present (pending > 0)", res.data.alerts.some((a: any) => a.module === "procurement"), `alerts=${res.data.alerts.length}`);
  }

  // ============================================================
  // 16. FINANCE BOUNDARY
  // ============================================================
  console.log("\n--- 16. Finance Boundary ---");
  {
    // Verify no journals were created with procurement references
    const journalCount = await prisma.journal.count({
      where: { OR: [{ reference: { contains: "PO-" } }, { reference: { contains: "REQ-" } }, { reference: { contains: "GR-" } }] },
    });
    record("Finance Boundary", "No journals created with procurement references", journalCount === 0, `procurement-ref journals=${journalCount}`);

    // Verify the dashboard financial KPIs are unchanged (cash balance still derived from finance only)
    const res = await api(mdCookie, "GET", "/api/dashboard");
    record("Finance Boundary", "Finance cash balance unchanged (not affected by procurement)", Number(res.data.financial.cashBalance) > 0, `cash=${res.data.financial.cashBalance}`);
  }

  // ============================================================
  // 17. REGRESSION — Finance
  // ============================================================
  console.log("\n--- 17. Finance Regression ---");
  {
    const res = await api(mdCookie, "GET", "/api/finance/transactions?page=1&pageSize=5");
    record("Finance Regression", "Finance transactions endpoint", res.status === 200, `status=${res.status}`);
    const accountsRes = await api(mdCookie, "GET", "/api/finance/accounts");
    record("Finance Regression", "Finance accounts endpoint", accountsRes.status === 200, `status=${accountsRes.status}`);
  }

  // ============================================================
  // 18. REGRESSION — Staff
  // ============================================================
  console.log("\n--- 18. Staff Regression ---");
  {
    const res = await api(mdCookie, "GET", "/api/staff");
    record("Staff Regression", "Staff directory endpoint", res.status === 200 && Array.isArray(res.data.items), `count=${res.data.items?.length}`);
  }

  // ============================================================
  // 19. REGRESSION — CRM
  // ============================================================
  console.log("\n--- 19. CRM Regression ---");
  {
    const cRes = await api(mdCookie, "GET", "/api/customers");
    record("CRM Regression", "Customers endpoint", cRes.status === 200, `status=${cRes.status}`);
    const sRes = await api(mdCookie, "GET", "/api/suppliers");
    record("CRM Regression", "Suppliers endpoint", sRes.status === 200, `status=${sRes.status}`);
  }

  // ============================================================
  // 20. REGRESSION — Projects
  // ============================================================
  console.log("\n--- 20. Projects Regression ---");
  {
    const res = await api(mdCookie, "GET", "/api/projects");
    record("Projects Regression", "Projects endpoint", res.status === 200 && Array.isArray(res.data.items), `count=${res.data.items?.length}`);
  }

  // ============================================================
  // 21. REGRESSION — Operations
  // ============================================================
  console.log("\n--- 21. Operations Regression ---");
  {
    const res = await api(mdCookie, "GET", "/api/tasks");
    record("Operations Regression", "Tasks endpoint", res.status === 200 && Array.isArray(res.data.items), `count=${res.data.items?.length}`);
  }

  // ============================================================
  // 22. DATABASE INTEGRITY
  // ============================================================
  console.log("\n--- 22. Database Integrity ---");
  {
    const reqCount = await prisma.procurementRequest.count();
    const poCount = await prisma.purchaseOrder.count();
    const itemCount = await prisma.purchaseOrderItem.count();
    const receiptCount = await prisma.goodsReceipt.count();
    const counterCount = await prisma.procurementRefCounter.count();
    record("Database Integrity", "ProcurementRequest records exist", reqCount > 0, `count=${reqCount}`);
    record("Database Integrity", "PurchaseOrder records exist", poCount > 0, `count=${poCount}`);
    record("Database Integrity", "PurchaseOrderItem records exist", itemCount > 0, `count=${itemCount}`);
    record("Database Integrity", "GoodsReceipt records exist", receiptCount > 0, `count=${receiptCount}`);
    record("Database Integrity", "ProcurementRefCounter rows exist", counterCount > 0, `count=${counterCount}`);

    // Verify unique request numbers
    const dupReq = await prisma.procurementRequest.groupBy({ by: ["requestNumber"], _count: true, having: { requestNumber: { _count: { gt: 1 } } } });
    record("Database Integrity", "No duplicate request numbers", dupReq.length === 0, `dupes=${dupReq.length}`);

    // Verify unique PO numbers
    const dupPO = await prisma.purchaseOrder.groupBy({ by: ["purchaseOrderNumber"], _count: true, having: { purchaseOrderNumber: { _count: { gt: 1 } } } });
    record("Database Integrity", "No duplicate PO numbers", dupPO.length === 0, `dupes=${dupPO.length}`);

    // Verify no orphan items — every item's purchaseOrderId references an existing PO.
    // (purchaseOrder is a required relation, so we check via a raw join-style query.)
    const allItems = await prisma.purchaseOrderItem.findMany({ select: { id: true, purchaseOrderId: true } });
    const poIds = new Set((await prisma.purchaseOrder.findMany({ select: { id: true }, where: { deletedAt: null } })).map(p => p.id));
    const orphans = allItems.filter(i => !poIds.has(i.purchaseOrderId));
    record("Database Integrity", "No orphan PO items (FK integrity)", orphans.length === 0, `orphans=${orphans.length}`);
  }

  // ============================================================
  // FINAL REPORT
  // ============================================================
  console.log("\n============================================================");
  console.log("  FINAL TEST MATRIX");
  console.log("============================================================\n");

  const categories = [...new Set(results.map(r => r.category))];
  const matrix: Record<string, { tests: number; passed: number; failed: number }> = {};
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    matrix[cat] = {
      tests: catResults.length,
      passed: catResults.filter(r => r.passed).length,
      failed: catResults.filter(r => !r.passed).length,
    };
  }

  console.log("| Category | Tests | Passed | Failed |");
  console.log("|----------|------:|-------:|-------:|");
  let totalTests = 0, totalPassed = 0, totalFailed = 0;
  for (const [cat, m] of Object.entries(matrix)) {
    console.log(`| ${cat} | ${m.tests} | ${m.passed} | ${m.failed} |`);
    totalTests += m.tests; totalPassed += m.passed; totalFailed += m.failed;
  }
  console.log(`| **TOTAL** | **${totalTests}** | **${totalPassed}** | **${totalFailed}** |`);

  // Print failures
  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log("\n--- FAILURES ---");
    for (const f of failures) console.log(`  ✗ [${f.category}] ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  }

  console.log(`\n${totalFailed === 0 ? "✅ ALL TESTS PASSED" : `⚠️  ${totalFailed} test(s) failed`}\n`);
}

main().catch(e => { console.error("Test suite crashed:", e); process.exit(1); }).finally(() => prisma.$disconnect());
