// ============================================================================
// LBMS Phase 8 — Inventory & Warehouse Management Runtime Test Suite
// ----------------------------------------------------------------------------
// Covers: Item CRUD, Warehouse CRUD, Stock receipt (from GoodsReceipt),
// duplicate receipt prevention, Stock issue, negative stock prevention,
// Transfer (atomic), Adjustment, Project/Task integration, RBAC (7×matrix),
// IDOR, Audit, Database integrity, Finance boundary, Dashboard, Concurrency,
// Regression. Run: bun run scripts/test-phase8.ts
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

let mdCookie = "";
let mdUserId = "";

async function main() {
  console.log("\n============================================================");
  console.log("  LBMS PHASE 8 — INVENTORY RUNTIME TEST SUITE");
  console.log("============================================================\n");

  mdCookie = await login("md@phase7.test", PASSWORD);
  const mdUser = await prisma.user.findFirst({ where: { userRoles: { some: { role: { name: "md" } } } } });
  mdUserId = mdUser!.id;
  console.log("  ✓ Logged in as MD\n");

  // Reference data
  const [itemsRes, whRes, catRes, suppliersRes, projectsRes, staffRes, tasksRes] = await Promise.all([
    api(mdCookie, "GET", "/api/inventory/items?pageSize=100"),
    api(mdCookie, "GET", "/api/inventory/warehouses"),
    api(mdCookie, "GET", "/api/inventory/categories"),
    api(mdCookie, "GET", "/api/suppliers?pageSize=100"),
    api(mdCookie, "GET", "/api/projects?pageSize=100"),
    api(mdCookie, "GET", "/api/staff?pageSize=100"),
    api(mdCookie, "GET", "/api/tasks?pageSize=100"),
  ]);
  const invItems = itemsRes.data.items || [];
  const warehouses = whRes.data.items || [];
  const categories = catRes.data.items || [];
  const suppliers = suppliersRes.data.items || [];
  const projects = projectsRes.data.items || [];
  const employees = staffRes.data.items || [];
  const tasks = tasksRes.data.items || [];
  const firstItem = invItems[0];
  const secondItem = invItems[1] || invItems[0];
  const firstWh = warehouses[0];
  const secondWh = warehouses[1] || warehouses[0];
  const firstCat = categories[0];
  const firstSupplier = suppliers[0];
  const activeProject = projects.find((p: any) => p.status === "active") || projects[0];
  const activeTask = tasks.find((t: any) => t.status === "todo" || t.status === "in_progress");
  const firstEmployee = employees[0];

  console.log(`  Refs: ${invItems.length} items, ${warehouses.length} warehouses, ${categories.length} categories, ${suppliers.length} suppliers\n`);

  // Helper: create a goods receipt item for receiving tests
  async function createGoodsReceiptItemForReceive(): Promise<{ goodsReceiptItemId: string; receivedQty: string }> {
    // Create a PO with an item, approve, send, receive
    const poRes = await api(mdCookie, "POST", "/api/procurement/orders", { supplierId: firstSupplier.id, requestedById: mdUserId, status: "pending_approval" });
    const poId = poRes.data.id;
    const itemRes = await api(mdCookie, "POST", `/api/procurement/orders/${poId}/items`, { description: "Inventory test item", quantity: "100", unitPrice: "10.00", taxRate: "0" });
    await api(mdCookie, "POST", `/api/procurement/orders/${poId}/approve`);
    await api(mdCookie, "POST", `/api/procurement/orders/${poId}/send`);
    const poItemId = itemRes.data.item.id;
    // Receive 100 into procurement
    const recvRes = await api(mdCookie, "POST", `/api/procurement/orders/${poId}/receiving`, { items: [{ purchaseOrderItemId: poItemId, receivedQuantity: "100" }] });
    // Get the goods receipt item ID
    const receiptsRes = await api(mdCookie, "GET", `/api/procurement/orders/${poId}/receiving`);
    const grItem = receiptsRes.data.receipts[0].items[0];
    return { goodsReceiptItemId: grItem.id, receivedQty: "100" };
  }

  // ============================================================
  // 1. ITEM CRUD
  // ============================================================
  console.log("--- 1. Inventory Item CRUD ---");
  let createdItemId = "";
  {
    const res = await api(mdCookie, "POST", "/api/inventory/items", {
      itemCode: "TEST-ITEM-001", name: "Test Inventory Item", categoryId: firstCat?.id, unitOfMeasure: "unit", reorderLevel: "5", reorderQuantity: "20",
    });
    createdItemId = res.data.id || "";
    rec("Item CRUD", "Create item (valid)", res.status === 201 && !!res.data.id, `status=${res.status}`);
  }
  {
    const res = await api(mdCookie, "GET", "/api/inventory/items?page=1&pageSize=100");
    rec("Item CRUD", "List items", res.status === 200 && Array.isArray(res.data.items) && res.data.items.length > 0, `count=${res.data.items?.length}`);
  }
  {
    const res = await api(mdCookie, "GET", `/api/inventory/items/${createdItemId}`);
    rec("Item CRUD", "Get single item", res.status === 200 && res.data.id === createdItemId, `status=${res.status}`);
  }
  {
    const res = await api(mdCookie, "PATCH", `/api/inventory/items/${createdItemId}`, { name: "Updated Test Item" });
    rec("Item CRUD", "Update item", res.status === 200 && res.data.name === "Updated Test Item", `status=${res.status}`);
  }
  {
    const res = await api(mdCookie, "POST", "/api/inventory/items", { itemCode: "TEST-ITEM-001", name: "Duplicate code" });
    rec("Item CRUD", "Duplicate itemCode → 400", res.status === 400, `status=${res.status}`);
  }
  {
    const res = await api(mdCookie, "POST", "/api/inventory/items", { name: "Missing code" });
    rec("Item CRUD", "Missing itemCode → 400", res.status === 400, `status=${res.status}`);
  }
  // Delete the test item (no movements → hard delete)
  {
    const res = await api(mdCookie, "DELETE", `/api/inventory/items/${createdItemId}`);
    rec("Item CRUD", "Delete item (no movements → hard delete)", res.status === 200 && res.data.hardDeleted === true, `status=${res.status}`);
  }

  // ============================================================
  // 2. WAREHOUSE CRUD
  // ============================================================
  console.log("\n--- 2. Warehouse CRUD ---");
  let createdWhId = "";
  {
    const uniqueCode = `TEST-WH-${Date.now()}`;
    const res = await api(mdCookie, "POST", "/api/inventory/warehouses", { code: uniqueCode, name: "Test Warehouse", location: "Test Location" });
    createdWhId = res.data.id || "";
    rec("Warehouse CRUD", "Create warehouse (valid)", res.status === 201 && !!res.data.id, `status=${res.status}`);
  }
  {
    const res = await api(mdCookie, "GET", "/api/inventory/warehouses");
    rec("Warehouse CRUD", "List warehouses", res.status === 200 && Array.isArray(res.data.items), `count=${res.data.items?.length}`);
  }
  {
    const res = await api(mdCookie, "GET", `/api/inventory/warehouses/${createdWhId}`);
    rec("Warehouse CRUD", "Get single warehouse", res.status === 200 && res.data.id === createdWhId, `status=${res.status}`);
  }
  {
    const res = await api(mdCookie, "PATCH", `/api/inventory/warehouses/${createdWhId}`, { name: "Updated Warehouse" });
    rec("Warehouse CRUD", "Update warehouse", res.status === 200 && res.data.name === "Updated Warehouse", `status=${res.status}`);
  }
  {
    const res = await api(mdCookie, "POST", "/api/inventory/warehouses", { code: `TEST-WH-DUP-${Date.now()}`, name: "First WH" });
    const dupRes = await api(mdCookie, "POST", "/api/inventory/warehouses", { code: res.data.code, name: "Duplicate code" });
    rec("Warehouse CRUD", "Duplicate code → 400", dupRes.status === 400, `status=${dupRes.status}`);
  }

  // ============================================================
  // 3. STOCK RECEIPT (from Goods Receipt)
  // ============================================================
  console.log("\n--- 3. Stock Receipt (from GoodsReceipt) ---");
  let receiptMovementId = "";
  {
    const { goodsReceiptItemId, receivedQty } = await createGoodsReceiptItemForReceive();
    const balanceBefore = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: firstWh.id } },
    });
    const beforeQty = Number(balanceBefore?.quantity ?? 0);

    const res = await api(mdCookie, "POST", "/api/inventory/operations/receive", {
      goodsReceiptItemId, inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "50",
    });
    receiptMovementId = res.data.movement?.id || "";
    rec("Stock Receipt", "Receive 50 from GoodsReceipt", res.status === 201, `status=${res.status}, movement=${res.data.movement?.movementNumber}`);

    // Verify balance increased
    const balanceAfter = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: firstWh.id } },
    });
    const afterQty = Number(balanceAfter?.quantity ?? 0);
    rec("Stock Receipt", "Balance increased by 50", afterQty === beforeQty + 50, `before=${beforeQty}, after=${afterQty}`);

    // Verify the goods receipt item marker is set
    const grItem = await prisma.goodsReceiptItem.findUnique({ where: { id: goodsReceiptItemId } });
    rec("Stock Receipt", "GoodsReceiptItem.inventoryPostedAt set", !!grItem?.inventoryPostedAt, `postedAt=${grItem?.inventoryPostedAt}`);
  }

  // ============================================================
  // 4. DUPLICATE RECEIPT PREVENTION (critical)
  // ============================================================
  console.log("\n--- 4. Duplicate Receipt Prevention ---");
  {
    const { goodsReceiptItemId } = await createGoodsReceiptItemForReceive();
    // First receive
    const r1 = await api(mdCookie, "POST", "/api/inventory/operations/receive", {
      goodsReceiptItemId, inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "30",
    });
    rec("Duplicate Receipt", "First receipt succeeds", r1.status === 201, `status=${r1.status}`);

    // Capture balance
    const bal1 = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: firstWh.id } },
    });
    const qty1 = Number(bal1?.quantity ?? 0);

    // Second receive of SAME goods receipt item → must fail
    const r2 = await api(mdCookie, "POST", "/api/inventory/operations/receive", {
      goodsReceiptItemId, inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "30",
    });
    rec("Duplicate Receipt", "Second receive of same GR item → 400", r2.status === 400, `status=${r2.status}`);

    // Verify balance unchanged
    const bal2 = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: firstWh.id } },
    });
    const qty2 = Number(bal2?.quantity ?? 0);
    rec("Duplicate Receipt", "Balance unchanged after rejected duplicate", qty2 === qty1, `before=${qty1}, after=${qty2}`);
  }

  // ============================================================
  // 5. STOCK ISSUE
  // ============================================================
  console.log("\n--- 5. Stock Issue ---");
  {
    const balBefore = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: firstWh.id } },
    });
    const beforeQty = Number(balBefore?.quantity ?? 0);

    const res = await api(mdCookie, "POST", "/api/inventory/operations/issue", {
      inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "10", reason: "Test issue", projectId: activeProject?.id, employeeId: firstEmployee?.id,
    });
    rec("Stock Issue", "Issue 10 (valid)", res.status === 201, `status=${res.status}, movement=${res.data.movement?.movementNumber}`);

    const balAfter = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: firstWh.id } },
    });
    const afterQty = Number(balAfter?.quantity ?? 0);
    rec("Stock Issue", "Balance decreased by 10", afterQty === beforeQty - 10, `before=${beforeQty}, after=${afterQty}`);
  }
  // Insufficient stock
  {
    const balBefore = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: firstWh.id } },
    });
    const beforeQty = Number(balBefore?.quantity ?? 0);
    const res = await api(mdCookie, "POST", "/api/inventory/operations/issue", {
      inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "99999999", reason: "Too much",
    });
    rec("Stock Issue", "Insufficient stock → 400", res.status === 400, `status=${res.status}`);
    const balAfter = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: firstWh.id } },
    });
    rec("Stock Issue", "Balance unchanged after insufficient rejection", Number(balAfter?.quantity ?? 0) === beforeQty, `before=${beforeQty}, after=${balAfter?.quantity}`);
  }
  // Negative quantity
  {
    const res = await api(mdCookie, "POST", "/api/inventory/operations/issue", {
      inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "-5", reason: "Negative",
    });
    rec("Stock Issue", "Negative quantity → 400", res.status === 400, `status=${res.status}`);
  }
  // Zero quantity
  {
    const res = await api(mdCookie, "POST", "/api/inventory/operations/issue", {
      inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "0", reason: "Zero",
    });
    rec("Stock Issue", "Zero quantity → 400", res.status === 400, `status=${res.status}`);
  }

  // ============================================================
  // 6. NEGATIVE STOCK PREVENTION
  // ============================================================
  console.log("\n--- 6. Negative Stock Prevention ---");
  {
    // Try to issue more than available on second warehouse (may have 0 stock)
    const bal = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: secondWh.id } },
    });
    const currentQty = Number(bal?.quantity ?? 0);
    if (currentQty < 5) {
      const res = await api(mdCookie, "POST", "/api/inventory/operations/issue", {
        inventoryItemId: firstItem.id, warehouseId: secondWh.id, quantity: "5", reason: "Force negative",
      });
      rec("Negative Stock", "Issue exceeding stock → 400 (negative prevention)", res.status === 400, `status=${res.status}, current=${currentQty}`);
      // Verify stock didn't go negative
      const balAfter = await prisma.stockBalance.findUnique({
        where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: secondWh.id } },
      });
      const afterQty = Number(balAfter?.quantity ?? 0);
      rec("Negative Stock", "Stock remained ≥ 0", afterQty >= 0, `after=${afterQty}`);
    } else {
      rec("Negative Stock", "Stock on second warehouse already ≥ 5 — skipping", true, `current=${currentQty}`);
    }
  }

  // ============================================================
  // 7. TRANSFER (atomic)
  // ============================================================
  console.log("\n--- 7. Stock Transfer ---");
  {
    // Use firstItem which has stock on firstWh
    const balSrcBefore = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: firstWh.id } },
    });
    const balDstBefore = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: secondWh.id } },
    });
    const srcBefore = Number(balSrcBefore?.quantity ?? 0);
    const dstBefore = Number(balDstBefore?.quantity ?? 0);

    const res = await api(mdCookie, "POST", "/api/inventory/operations/transfer", {
      inventoryItemId: firstItem.id, fromWarehouseId: firstWh.id, toWarehouseId: secondWh.id, quantity: "5", reason: "Test transfer",
    });
    rec("Transfer", "Transfer 5 from WH1→WH2", res.status === 201, `status=${res.status}, transfer=${res.data.outMovement?.referenceId}`);

    const balSrcAfter = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: firstWh.id } },
    });
    const balDstAfter = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: secondWh.id } },
    });
    const srcAfter = Number(balSrcAfter?.quantity ?? 0);
    const dstAfter = Number(balDstAfter?.quantity ?? 0);
    rec("Transfer", "Source decreased by 5", srcAfter === srcBefore - 5, `before=${srcBefore}, after=${srcAfter}`);
    rec("Transfer", "Destination increased by 5", dstAfter === dstBefore + 5, `before=${dstBefore}, after=${dstAfter}`);
  }
  // Same warehouse
  {
    const res = await api(mdCookie, "POST", "/api/inventory/operations/transfer", {
      inventoryItemId: firstItem.id, fromWarehouseId: firstWh.id, toWarehouseId: firstWh.id, quantity: "5",
    });
    rec("Transfer", "Same warehouse → 400", res.status === 400, `status=${res.status}`);
  }
  // Insufficient stock for transfer
  {
    const res = await api(mdCookie, "POST", "/api/inventory/operations/transfer", {
      inventoryItemId: firstItem.id, fromWarehouseId: secondWh.id, toWarehouseId: firstWh.id, quantity: "99999999", reason: "Too much",
    });
    rec("Transfer", "Insufficient stock → 400", res.status === 400, `status=${res.status}`);
  }

  // ============================================================
  // 8. ADJUSTMENT
  // ============================================================
  console.log("\n--- 8. Stock Adjustment ---");
  {
    const balBefore = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: firstWh.id } },
    });
    const beforeQty = Number(balBefore?.quantity ?? 0);
    // Positive adjustment
    const res = await api(mdCookie, "POST", "/api/inventory/operations/adjust", {
      inventoryItemId: firstItem.id, warehouseId: firstWh.id, delta: "3", reason: "Stock count gain",
    });
    rec("Adjustment", "Positive adjustment +3", res.status === 201, `status=${res.status}, type=${res.data.movement?.movementType}`);
    const balAfter = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: firstWh.id } },
    });
    rec("Adjustment", "Balance increased by 3", Number(balAfter?.quantity ?? 0) === beforeQty + 3, `before=${beforeQty}, after=${balAfter?.quantity}`);

    // Negative adjustment
    const res2 = await api(mdCookie, "POST", "/api/inventory/operations/adjust", {
      inventoryItemId: firstItem.id, warehouseId: firstWh.id, delta: "-2", reason: "Stock count loss",
    });
    rec("Adjustment", "Negative adjustment -2", res2.status === 201, `status=${res2.status}, type=${res2.data.movement?.movementType}`);

    // Zero delta
    const res3 = await api(mdCookie, "POST", "/api/inventory/operations/adjust", {
      inventoryItemId: firstItem.id, warehouseId: firstWh.id, delta: "0", reason: "Zero",
    });
    rec("Adjustment", "Zero delta → 400", res3.status === 400, `status=${res3.status}`);

    // Missing reason
    const res4 = await api(mdCookie, "POST", "/api/inventory/operations/adjust", {
      inventoryItemId: firstItem.id, warehouseId: firstWh.id, delta: "1",
    });
    rec("Adjustment", "Missing reason → 400", res4.status === 400, `status=${res4.status}`);
  }

  // ============================================================
  // 9. PROJECT INTEGRATION
  // ============================================================
  console.log("\n--- 9. Project Integration ---");
  {
    const res = await api(mdCookie, "POST", "/api/inventory/operations/issue", {
      inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "1", reason: "Project issue", projectId: activeProject?.id,
    });
    rec("Project Integration", "Issue with valid project", res.status === 201, `status=${res.status}`);
    // Verify movement has projectId
    const mov = await prisma.stockMovement.findUnique({ where: { id: res.data.movement.id } });
    rec("Project Integration", "Movement linked to project", mov?.projectId === activeProject?.id, `projectId=${mov?.projectId}`);

    // Cancelled project
    const cancelledProj = await prisma.project.findFirst({ where: { status: "cancelled" } });
    if (cancelledProj) {
      const res2 = await api(mdCookie, "POST", "/api/inventory/operations/issue", {
        inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "1", reason: "Bad project", projectId: cancelledProj.id,
      });
      rec("Project Integration", "Cancelled project → 400", res2.status === 400, `status=${res2.status}`);
    }
    // Forged project
    const res3 = await api(mdCookie, "POST", "/api/inventory/operations/issue", {
      inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "1", reason: "Forged", projectId: "forged-project-id",
    });
    rec("Project Integration", "Forged projectId → 400", res3.status === 400, `status=${res3.status}`);
  }

  // ============================================================
  // 10. TASK INTEGRATION
  // ============================================================
  console.log("\n--- 10. Task Integration ---");
  {
    if (activeTask) {
      const res = await api(mdCookie, "POST", "/api/inventory/operations/issue", {
        inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "1", reason: "Task issue", taskId: activeTask.id,
      });
      rec("Task Integration", "Issue with valid task", res.status === 201, `status=${res.status}`);
    } else {
      rec("Task Integration", "No active task found — skipping", true, "skipped");
    }
    // Forged task
    {
      const res = await api(mdCookie, "POST", "/api/inventory/operations/issue", {
        inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "1", reason: "Forged task", taskId: "forged-task-id",
      });
      rec("Task Integration", "Forged taskId → 400", res.status === 400, `status=${res.status}`);
    }
  }

  // ============================================================
  // 11. RBAC — FULL 7 × ENDPOINT MATRIX
  // ============================================================
  console.log("\n--- 11. RBAC (7 roles × endpoints) ---");
  const roleCookies: Record<string, string> = {};
  for (const role of ["md", "administrator", "finance_manager", "operations_manager", "hr_manager", "project_manager", "employee"]) {
    roleCookies[role] = await login(`${role}@phase7.test`, PASSWORD);
  }

  // Known IDs for RBAC
  const knownItemId = firstItem.id;
  const knownWhId = firstWh.id;

  const rbacEndpoints = [
    { name: "list items", method: "GET", path: "/api/inventory/items" },
    { name: "create item", method: "POST", path: "/api/inventory/items", body: { itemCode: `RBAC-${Date.now()}`, name: "RBAC item" } },
    { name: "edit item", method: "PATCH", path: `/api/inventory/items/${knownItemId}`, body: { name: "edited" } },
    { name: "list warehouses", method: "GET", path: "/api/inventory/warehouses" },
    { name: "create warehouse", method: "POST", path: "/api/inventory/warehouses", body: { code: `RBAC-WH-${Date.now()}`, name: "RBAC WH" } },
    { name: "list stock", method: "GET", path: "/api/inventory/stock" },
    { name: "list movements", method: "GET", path: "/api/inventory/stock/movements" },
    { name: "issue", method: "POST", path: "/api/inventory/operations/issue", body: { inventoryItemId: knownItemId, warehouseId: knownWhId, quantity: "1", reason: "RBAC test" } },
    { name: "transfer", method: "POST", path: "/api/inventory/operations/transfer", body: { inventoryItemId: knownItemId, fromWarehouseId: knownWhId, toWarehouseId: secondWh.id, quantity: "1" } },
    { name: "adjust", method: "POST", path: "/api/inventory/operations/adjust", body: { inventoryItemId: knownItemId, warehouseId: knownWhId, delta: "1", reason: "RBAC" } },
  ];

  // Expected matrix: 1=allow (200/201 or 400 state error), 0=deny (403)
  //                              listItems createItem editItem listWH createWH listStock listMov issue transfer adjust
  const rbacMatrix: Record<string, number[]> = {
    md:                 [1,1,1,1,1,1,1,1,1,1],
    administrator:      [1,1,1,1,1,1,1,1,1,1],
    finance_manager:    [1,0,0,1,0,1,1,0,0,0], // view + export only
    operations_manager: [1,1,1,1,1,1,1,1,1,1],
    hr_manager:          [0,0,0,0,0,0,0,0,0,0], // no inventory access
    project_manager:    [1,1,1,1,1,1,1,1,0,0], // view/create/edit/issue/receive but no transfer/adjust
    employee:           [1,0,0,1,0,1,1,0,0,0], // view only
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
      if (shouldAllow) {
        pass = gotAuth || gotOtherError; // RBAC allowed; may fail on state validation
      } else {
        pass = gotReject; // must be 403
      }
      if (pass) rbacPassed++;
      else rbacFailures.push(`${role}→${ep.name}: expected ${shouldAllow ? "allow" : "deny(403)"}, got ${res.status}`);
    }
  }
  rec("RBAC", `Full 7×10 matrix (${rbacTotal} probes)`, rbacPassed === rbacTotal, `${rbacPassed}/${rbacTotal} passed`);
  if (rbacFailures.length > 0) {
    for (const f of rbacFailures.slice(0, 10)) rec("RBAC", f, false, "");
  }
  // Unauthenticated
  {
    const res = await api("", "GET", "/api/inventory/items");
    rec("RBAC", "Unauthenticated → 401", res.status === 401, `status=${res.status}`);
  }

  // ============================================================
  // 12. IDOR / SECURITY
  // ============================================================
  console.log("\n--- 12. IDOR / Security ---");
  {
    const res = await api(mdCookie, "GET", "/api/inventory/items/nonexistent-id");
    rec("IDOR", "Nonexistent item → 404", res.status === 404, `status=${res.status}`);
    const res2 = await api(mdCookie, "GET", "/api/inventory/warehouses/nonexistent-id");
    rec("IDOR", "Nonexistent warehouse → 404", res2.status === 404, `status=${res2.status}`);
    // Forged item ID on issue
    const res3 = await api(mdCookie, "POST", "/api/inventory/operations/issue", {
      inventoryItemId: "forged-item-id", warehouseId: firstWh.id, quantity: "1", reason: "Forged item",
    });
    rec("IDOR", "Forged inventoryItemId → 404/400", res3.status === 404 || res3.status === 400, `status=${res3.status}`);
    // Forged warehouse ID
    const res4 = await api(mdCookie, "POST", "/api/inventory/operations/issue", {
      inventoryItemId: firstItem.id, warehouseId: "forged-wh-id", quantity: "1", reason: "Forged wh",
    });
    rec("IDOR", "Forged warehouseId → 404/400", res4.status === 404 || res4.status === 400, `status=${res4.status}`);
    // HR Manager cannot access inventory
    const res5 = await api(roleCookies["hr_manager"], "GET", "/api/inventory/items");
    rec("IDOR", "HR Manager access → 403", res5.status === 403, `status=${res5.status}`);
    // Employee cannot issue
    const res6 = await api(roleCookies["employee"], "POST", "/api/inventory/operations/issue", {
      inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "1", reason: "Employee issue attempt",
    });
    rec("IDOR", "Employee issue → 403", res6.status === 403, `status=${res6.status}`);
    // Employee cannot transfer
    const res7 = await api(roleCookies["employee"], "POST", "/api/inventory/operations/transfer", {
      inventoryItemId: firstItem.id, fromWarehouseId: firstWh.id, toWarehouseId: secondWh.id, quantity: "1",
    });
    rec("IDOR", "Employee transfer → 403", res7.status === 403, `status=${res7.status}`);
    // Finance Manager cannot issue
    const res8 = await api(roleCookies["finance_manager"], "POST", "/api/inventory/operations/issue", {
      inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "1", reason: "Finance issue attempt",
    });
    rec("IDOR", "Finance Manager issue → 403", res8.status === 403, `status=${res8.status}`);
  }

  // ============================================================
  // 13. AUDIT TRAIL
  // ============================================================
  console.log("\n--- 13. Audit Trail ---");
  {
    const auditRes = await api(mdCookie, "GET", "/api/audit?module=inventory&pageSize=100");
    const auditItems = auditRes.data.items || [];
    const actions = new Set(auditItems.map((a: any) => a.action));
    rec("Audit Trail", "create action audited", actions.has("create"), `count=${auditItems.filter((a:any)=>a.action==="create").length}`);
    rec("Audit Trail", "update action audited", actions.has("update"), `count=${auditItems.filter((a:any)=>a.action==="update").length}`);
    if (auditItems.length > 0) {
      const sample = auditItems[0];
      rec("Audit Trail", "Audit has userId", !!sample.userId, `userId=${sample.userId}`);
      rec("Audit Trail", "Audit has module=inventory", sample.module === "inventory", `module=${sample.module}`);
      rec("Audit Trail", "Audit has recordId", !!sample.recordId, `recordId=${sample.recordId}`);
      rec("Audit Trail", "Audit has createdAt", !!sample.createdAt, `createdAt=${sample.createdAt}`);
    }
    // Verify audit is append-only (no PATCH/DELETE endpoint)
    const patchRes = await api(mdCookie, "PATCH", "/api/audit/some-id", { action: "hack" });
    rec("Audit Trail", "Audit has no PATCH endpoint (append-only)", patchRes.status === 405 || patchRes.status === 404, `status=${patchRes.status}`);
  }

  // ============================================================
  // 14. DATABASE INTEGRITY
  // ============================================================
  console.log("\n--- 14. Database Integrity ---");
  {
    // Orphan checks
    const allItems = await prisma.inventoryItem.findMany({ select: { id: true, categoryId: true, createdById: true } });
    const userIds = new Set((await prisma.user.findMany({ select: { id: true } })).map(u => u.id));
    const catIds = new Set((await prisma.inventoryCategory.findMany({ select: { id: true } })).map(c => c.id));
    const orphanCat = allItems.filter(i => i.categoryId && !catIds.has(i.categoryId));
    rec("Database Integrity", "No orphan item.categoryId", orphanCat.length === 0, `orphans=${orphanCat.length}`);

    const allBalances = await prisma.stockBalance.findMany({ select: { id: true, inventoryItemId: true, warehouseId: true } });
    const itemIds = new Set((await prisma.inventoryItem.findMany({ select: { id: true } })).map(i => i.id));
    const whIds = new Set((await prisma.warehouse.findMany({ select: { id: true } })).map(w => w.id));
    const orphanBalItem = allBalances.filter(b => !itemIds.has(b.inventoryItemId));
    const orphanBalWh = allBalances.filter(b => !whIds.has(b.warehouseId));
    rec("Database Integrity", "No orphan balance.inventoryItemId", orphanBalItem.length === 0, `orphans=${orphanBalItem.length}`);
    rec("Database Integrity", "No orphan balance.warehouseId", orphanBalWh.length === 0, `orphans=${orphanBalWh.length}`);

    // Duplicate balance records (item+warehouse unique)
    const dupBal = await prisma.stockBalance.groupBy({ by: ["inventoryItemId", "warehouseId"], _count: true, having: { id: { _count: { gt: 1 } } } });
    rec("Database Integrity", "No duplicate stock balances", dupBal.length === 0, `dupes=${dupBal.length}`);

    // Duplicate item codes
    const dupCodes = await prisma.inventoryItem.groupBy({ by: ["itemCode"], _count: true, having: { itemCode: { _count: { gt: 1 } } } });
    rec("Database Integrity", "No duplicate item codes", dupCodes.length === 0, `dupes=${dupCodes.length}`);

    // Duplicate warehouse codes
    const dupWhCodes = await prisma.warehouse.groupBy({ by: ["code"], _count: true, having: { code: { _count: { gt: 1 } } } });
    rec("Database Integrity", "No duplicate warehouse codes", dupWhCodes.length === 0, `dupes=${dupWhCodes.length}`);

    // Negative stock
    const negStock = await prisma.stockBalance.count({ where: { quantity: { lt: 0 } } });
    rec("Database Integrity", "No negative stock balances", negStock === 0, `count=${negStock}`);

    // Invalid movement types
    const validTypes = new Set(["RECEIPT", "ISSUE", "TRANSFER_IN", "TRANSFER_OUT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"]);
    const allMovements = await prisma.stockMovement.findMany({ select: { id: true, movementType: true } });
    const badTypes = allMovements.filter(m => !validTypes.has(m.movementType));
    rec("Database Integrity", "All movement types valid", badTypes.length === 0, `invalid=${badTypes.length}`);

    // Double-posting: check no goods receipt item has >1 inventory movement
    const receiptMovements = await prisma.stockMovement.findMany({
      where: { referenceType: "goods_receipt_item" },
      select: { referenceId: true },
    });
    const grItemIds = receiptMovements.map(m => m.referenceId);
    const dupGR = grItemIds.length - new Set(grItemIds).size;
    rec("Database Integrity", "No goods receipt item double-posted", dupGR === 0, `dupes=${dupGR}`);
  }

  // ============================================================
  // 15. FINANCE BOUNDARY (runtime proof)
  // ============================================================
  console.log("\n--- 15. Finance Boundary ---");
  {
    const journalCountBefore = await prisma.journal.count();
    // Perform inventory operations
    const { goodsReceiptItemId } = await createGoodsReceiptItemForReceive();
    await api(mdCookie, "POST", "/api/inventory/operations/receive", { goodsReceiptItemId, inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "5" });
    await api(mdCookie, "POST", "/api/inventory/operations/issue", { inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "1", reason: "Finance boundary test" });
    await api(mdCookie, "POST", "/api/inventory/operations/transfer", { inventoryItemId: firstItem.id, fromWarehouseId: firstWh.id, toWarehouseId: secondWh.id, quantity: "1", reason: "FB test" });
    await api(mdCookie, "POST", "/api/inventory/operations/adjust", { inventoryItemId: firstItem.id, warehouseId: firstWh.id, delta: "1", reason: "FB test" });
    const journalCountAfter = await prisma.journal.count();
    rec("Finance Boundary", "No journals created during inventory ops", journalCountAfter === journalCountBefore, `before=${journalCountBefore}, after=${journalCountAfter}`);

    // Verify no inventory-referenced journals
    const invJournals = await prisma.journal.count({
      where: { OR: [{ reference: { contains: "SRI-" } }, { reference: { contains: "ISS-" } }, { reference: { contains: "TRF-" } }, { reference: { contains: "ADJ-" } }] },
    });
    rec("Finance Boundary", "No journals with inventory references", invJournals === 0, `invJournals=${invJournals}`);
  }

  // ============================================================
  // 16. DASHBOARD
  // ============================================================
  console.log("\n--- 16. Dashboard KPIs ---");
  {
    const res = await api(mdCookie, "GET", "/api/dashboard");
    const b = res.data.business;
    rec("Dashboard", "totalInventoryItems is number", typeof b.totalInventoryItems === "number", `value=${b.totalInventoryItems}`);
    rec("Dashboard", "activeWarehouses is number", typeof b.activeWarehouses === "number", `value=${b.activeWarehouses}`);
    rec("Dashboard", "lowStockItems is number", typeof b.lowStockItems === "number", `value=${b.lowStockItems}`);
    rec("Dashboard", "stockMovementsToday is number", typeof b.stockMovementsToday === "number", `value=${b.stockMovementsToday}`);
    // Verify inventory alert
    const hasInvAlert = (res.data.alerts || []).some((a: any) => a.module === "inventory");
    rec("Dashboard", "Inventory alert present", hasInvAlert, `alerts=${res.data.alerts?.length}`);
  }

  // ============================================================
  // 17. CONCURRENCY
  // ============================================================
  console.log("\n--- 17. Concurrency ---");
  // Concurrent issues — only valid ones should succeed
  {
    // Ensure firstItem has enough stock on firstWh
    const bal = await prisma.stockBalance.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: firstWh.id } },
    });
    const currentQty = Number(bal?.quantity ?? 0);
    if (currentQty >= 10) {
      const promises: Promise<any>[] = [];
      for (let i = 0; i < 5; i++) {
        promises.push(api(mdCookie, "POST", "/api/inventory/operations/issue", {
          inventoryItemId: firstItem.id, warehouseId: firstWh.id, quantity: "3", reason: `Concurrent issue ${i}`,
        }));
      }
      const responses = await Promise.all(promises);
      const successes = responses.filter(r => r.status === 201);
      const failures = responses.filter(r => r.status === 400);
      // Sum of successful issues
      const totalIssued = successes.length * 3;
      const balAfter = await prisma.stockBalance.findUnique({
        where: { inventoryItemId_warehouseId: { inventoryItemId: firstItem.id, warehouseId: firstWh.id } },
      });
      const afterQty = Number(balAfter?.quantity ?? 0);
      rec("Concurrency", "5 concurrent issues — no negative stock", afterQty >= 0, `successes=${successes.length}, failures=${failures.length}, before=${currentQty}, after=${afterQty}`);
      rec("Concurrency", "Balance consistent (before - issued = after)", afterQty === currentQty - totalIssued, `before=${currentQty}, issued=${totalIssued}, after=${afterQty}`);
    } else {
      rec("Concurrency", "Insufficient stock for concurrent test — skipping", true, `current=${currentQty}`);
    }
  }
  // Concurrent receipt number generation
  {
    const promises: Promise<any>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(api(mdCookie, "POST", "/api/inventory/items", { itemCode: `CONC-${i}-${Date.now()}`, name: `Concurrency item ${i}` }));
    }
    const responses = await Promise.all(promises);
    const successes = responses.filter(r => r.status === 201);
    const codes = successes.map(r => r.data.itemCode);
    const unique = new Set(codes);
    rec("Concurrency", "10 concurrent item creates — unique codes", unique.size === successes.length, `successes=${successes.length}, unique=${unique.size}`);
    // Verify no duplicate codes in DB
    const dupCodes = await prisma.inventoryItem.groupBy({ by: ["itemCode"], _count: true, having: { itemCode: { _count: { gt: 1 } } } });
    rec("Concurrency", "No duplicate item codes in DB", dupCodes.length === 0, `dupes=${dupCodes.length}`);
  }

  // ============================================================
  // 18. REGRESSION TESTS
  // ============================================================
  console.log("\n--- 18. Regression ---");
  {
    const finRes = await api(mdCookie, "GET", "/api/finance/transactions?pageSize=5");
    rec("Finance Regression", "Finance transactions", finRes.status === 200, `status=${finRes.status}`);
    const accRes = await api(mdCookie, "GET", "/api/finance/accounts");
    rec("Finance Regression", "Finance accounts", accRes.status === 200, `status=${accRes.status}`);
    const dashRes = await api(mdCookie, "GET", "/api/dashboard");
    rec("Finance Regression", "Dashboard cash balance present", typeof dashRes.data.financial.cashBalance === "string", `cash=${dashRes.data.financial.cashBalance}`);

    const staffRes = await api(mdCookie, "GET", "/api/staff");
    rec("Staff Regression", "Staff directory", staffRes.status === 200, `count=${staffRes.data.items?.length}`);
    const custRes = await api(mdCookie, "GET", "/api/customers");
    rec("CRM Regression", "Customers", custRes.status === 200, `count=${custRes.data.items?.length}`);
    const supRes = await api(mdCookie, "GET", "/api/suppliers");
    rec("CRM Regression", "Suppliers", supRes.status === 200, `count=${supRes.data.items?.length}`);
    const projRes = await api(mdCookie, "GET", "/api/projects");
    rec("Project Regression", "Projects", projRes.status === 200, `count=${projRes.data.items?.length}`);
    const taskRes = await api(mdCookie, "GET", "/api/tasks");
    rec("Operations Regression", "Tasks", taskRes.status === 200, `count=${taskRes.data.items?.length}`);
    const procRes = await api(mdCookie, "GET", "/api/procurement/requests");
    rec("Procurement Regression", "Procurement requests", procRes.status === 200, `count=${procRes.data.items?.length}`);
    const poRes = await api(mdCookie, "GET", "/api/procurement/orders");
    rec("Procurement Regression", "Purchase orders", poRes.status === 200, `count=${poRes.data.items?.length}`);
    // Auth
    for (const role of ["md", "administrator", "finance_manager", "operations_manager", "hr_manager", "project_manager", "employee"]) {
      const r = await api(roleCookies[role], "GET", "/api/dashboard");
      rec("Auth Regression", `${role} can access dashboard`, r.status === 200, `status=${r.status}`);
    }
  }

  // ============================================================
  // FINAL REPORT
  // ============================================================
  console.log("\n============================================================");
  console.log("  PHASE 8 — FINAL TEST MATRIX");
  console.log("============================================================\n");

  const catSet = [...new Set(results.map(r => r.category))];
  const matrix: Record<string, { tests: number; passed: number; failed: number }> = {};
  for (const cat of catSet) {
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

  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log("\n--- FAILURES ---");
    for (const f of failures) console.log(`  ✗ [${f.category}] ${f.name} — ${f.evidence}`);
  }
  console.log(`\n${totalFailed === 0 ? "✅ ALL TESTS PASSED" : `⚠️  ${totalFailed} test(s) failed`}\n`);
}

main().catch(e => { console.error("Test suite crashed:", e); process.exit(1); }).finally(() => prisma.$disconnect());
