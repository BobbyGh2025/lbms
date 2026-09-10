// Phase 7 focused seed: adds procurement permissions to existing roles + test data.
// Run with: bun run prisma/seed-phase7.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Phase 7 focused seed — permissions + test data\n");

  // 1. Ensure procurement permissions exist in the Permission catalogue
  const procurementActions = ["view", "create", "edit", "submit", "approve", "receive", "cancel", "export"];
  for (const action of procurementActions) {
    await prisma.permission.upsert({
      where: { module_action: { module: "procurement", action } },
      update: {},
      create: { module: "procurement", action, description: `Procurement: ${action}` },
    });
  }
  console.log(`  ✓ ${procurementActions.length} procurement permissions ensured`);

  // 2. Assign procurement permissions to roles
  const ROLE_POLICIES: Record<string, string[]> = {
    administrator: ["view", "create", "edit", "submit", "approve", "receive", "cancel", "export"],
    finance_manager: ["view", "create", "edit", "submit", "approve", "receive", "cancel", "export"],
    operations_manager: ["view", "create", "edit", "submit", "approve", "receive", "cancel", "export"],
    hr_manager: [], // HR has no procurement access by policy
    project_manager: ["view", "create", "edit", "submit", "receive"],
    employee: ["view"],
  };

  const mdRole = await prisma.role.findUnique({ where: { name: "md" } });
  if (mdRole) {
    // MD gets all procurement permissions too (in addition to the "*" bypass)
    ROLE_POLICIES["md"] = procurementActions;
  }

  for (const [roleName, actions] of Object.entries(ROLE_POLICIES)) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) continue;
    for (const action of actions) {
      const perm = await prisma.permission.findUnique({
        where: { module_action: { module: "procurement", action } },
      });
      if (!perm) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }
  console.log(`  ✓ Procurement permissions assigned to roles`);

  // 3. Test procurement data (skip if already exists)
  const existingReqCount = await prisma.procurementRequest.count();
  if (existingReqCount > 0) {
    console.log(`  ✓ Procurement test data already exists (${existingReqCount} requests) — skipping`);
    console.log("\n✅ Phase 7 focused seed complete.");
    return;
  }

  const mdUser = await prisma.user.findFirst({
    where: { userRoles: { some: { role: { name: "md" } } } },
  });
  if (!mdUser) throw new Error("MD user not found");

  const suppliers = await prisma.supplier.findMany({ where: { deletedAt: null }, orderBy: { supplierNumber: "asc" } });
  const firstSupplier = suppliers[0];
  const secondSupplier = suppliers[1];
  const thirdSupplier = suppliers[2];
  const opsEmployee = await prisma.employee.findUnique({ where: { employeeId: "LT-EMP-0003" } });
  const projForProc = await prisma.project.findFirst({ where: { status: "active" }, orderBy: { projectNumber: "asc" } });

  if (!opsEmployee || !firstSupplier || !secondSupplier || !thirdSupplier) {
    throw new Error("Required seed entities (suppliers/employee) not found");
  }

  // 3a. Procurement Requests
  const TEST_REQUESTS = [
    { title: "Laptops for new developer workstation", supplierId: secondSupplier.id, priority: "high", status: "draft" },
    { title: "Office internet subscription renewal", supplierId: firstSupplier.id, priority: "medium", status: "submitted" },
    { title: "Project site transport services", supplierId: thirdSupplier.id, priority: "critical", status: "approved", projectId: projForProc?.id },
  ];

  const createdRequests: { id: string; requestNumber: string; status: string }[] = [];
  for (const r of TEST_REQUESTS) {
    const year = new Date().getFullYear();
    const counter = await prisma.procurementRefCounter.upsert({
      where: { prefix_year: { prefix: "REQ", year } },
      update: { nextNumber: { increment: 1 } },
      create: { prefix: "REQ", year, nextNumber: 2 },
    });
    const num = `REQ-${year}-${String(counter.nextNumber - 1).padStart(6, "0")}`;
    const created = await prisma.procurementRequest.create({
      data: {
        requestNumber: num,
        title: r.title,
        requesterId: opsEmployee.id,
        supplierId: r.supplierId,
        projectId: r.projectId ?? null,
        priority: r.priority,
        status: r.status,
        requiredByDate: new Date(Date.now() + 14 * 86400000),
        createdById: mdUser.id,
        updatedById: mdUser.id,
        ...(r.status === "submitted" ? { submittedAt: new Date(), submittedById: mdUser.id } : {}),
        ...(r.status === "approved" ? { submittedAt: new Date(Date.now() - 86400000), submittedById: mdUser.id, approvedAt: new Date(), approvedById: mdUser.id } : {}),
      },
    });
    createdRequests.push({ id: created.id, requestNumber: created.requestNumber, status: created.status });
  }
  console.log(`  ✓ ${TEST_REQUESTS.length} test procurement requests ensured`);

  // 3b. Purchase Orders
  const approvedRequest = createdRequests.find((r) => r.status === "approved");
  const TEST_POS = [
    { supplierId: secondSupplier.id, status: "draft", projectId: undefined as string | undefined, reqId: undefined as string | undefined },
    { supplierId: firstSupplier.id, status: "pending_approval", projectId: projForProc?.id, reqId: undefined as string | undefined },
    { supplierId: thirdSupplier.id, status: "approved", projectId: undefined as string | undefined, reqId: approvedRequest?.id },
    { supplierId: secondSupplier.id, status: "sent", projectId: undefined as string | undefined, reqId: undefined as string | undefined },
    { supplierId: firstSupplier.id, status: "partially_received", projectId: undefined as string | undefined, reqId: undefined as string | undefined },
  ];

  const createdPOs: { id: string; purchaseOrderNumber: string; status: string }[] = [];
  for (const p of TEST_POS) {
    const year = new Date().getFullYear();
    const counter = await prisma.procurementRefCounter.upsert({
      where: { prefix_year: { prefix: "PO", year } },
      update: { nextNumber: { increment: 1 } },
      create: { prefix: "PO", year, nextNumber: 2 },
    });
    const num = `PO-${year}-${String(counter.nextNumber - 1).padStart(6, "0")}`;
    const created = await prisma.purchaseOrder.create({
      data: {
        purchaseOrderNumber: num,
        supplierId: p.supplierId,
        procurementRequestId: p.reqId ?? null,
        projectId: p.projectId ?? null,
        requestedById: mdUser.id,
        status: p.status,
        orderDate: new Date(),
        expectedDeliveryDate: new Date(Date.now() + 7 * 86400000),
        createdById: mdUser.id,
        updatedById: mdUser.id,
        ...(["approved", "sent", "partially_received", "received"].includes(p.status) ? { approvedAt: new Date(Date.now() - 86400000), approvedById: mdUser.id } : {}),
        ...(["sent", "partially_received", "received"].includes(p.status) ? { sentAt: new Date() } : {}),
      },
    });
    createdPOs.push({ id: created.id, purchaseOrderNumber: created.purchaseOrderNumber, status: created.status });
  }
  console.log(`  ✓ ${TEST_POS.length} test purchase orders ensured`);

  // 3c. Purchase Order Items
  const draftPO = createdPOs[0];
  const pendingPO = createdPOs[1];
  const sentPO = createdPOs[3];
  const partialPO = createdPOs[4];

  const ITEMS_BY_PO: Record<string, Array<{ description: string; quantity: string; unitPrice: string; taxRate: string }>> = {
    [draftPO.id]: [
      { description: "Dell Latitude 5540 Laptop", quantity: "2", unitPrice: "8500.00", taxRate: "15" },
      { description: 'Dell 27" Monitor', quantity: "2", unitPrice: "1200.00", taxRate: "15" },
    ],
    [pendingPO.id]: [
      { description: "MTN Business Fibre — monthly", quantity: "12", unitPrice: "1500.00", taxRate: "0" },
    ],
    [sentPO.id]: [
      { description: "Dell PowerEdge Server R760", quantity: "1", unitPrice: "45000.00", taxRate: "15" },
      { description: "UPS 3000VA", quantity: "1", unitPrice: "3500.00", taxRate: "15" },
    ],
    [partialPO.id]: [
      { description: "MTN Business Internet — 6 months", quantity: "6", unitPrice: "1500.00", taxRate: "0" },
    ],
  };

  for (const [poId, items] of Object.entries(ITEMS_BY_PO)) {
    for (const it of items) {
      const qty = Number(it.quantity);
      const price = Number(it.unitPrice);
      const subtotal = qty * price;
      const tax = (subtotal * Number(it.taxRate)) / 100;
      const total = subtotal + tax;
      await prisma.purchaseOrderItem.create({
        data: {
          purchaseOrderId: poId,
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          taxRate: it.taxRate,
          tax: tax.toFixed(2),
          total: total.toFixed(2),
        },
      });
    }
    const allItems = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: poId } });
    const subtotal = allItems.reduce((s, i) => s + Number(i.total.toString()) - Number(i.tax.toString()), 0);
    const tax = allItems.reduce((s, i) => s + Number(i.tax.toString()), 0);
    const total = allItems.reduce((s, i) => s + Number(i.total.toString()), 0);
    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { subtotal: subtotal.toFixed(2), tax: tax.toFixed(2), total: total.toFixed(2) },
    });
  }
  console.log(`  ✓ Purchase order items ensured`);

  // 3d. Goods receipt for partially_received PO
  const partialPOItems = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: partialPO.id } });
  if (partialPOItems.length > 0) {
    const year = new Date().getFullYear();
    const grCounter = await prisma.procurementRefCounter.upsert({
      where: { prefix_year: { prefix: "GR", year } },
      update: { nextNumber: { increment: 1 } },
      create: { prefix: "GR", year, nextNumber: 2 },
    });
    const grNum = `GR-${year}-${String(grCounter.nextNumber - 1).padStart(6, "0")}`;
    const gr = await prisma.goodsReceipt.create({
      data: {
        receiptNumber: grNum,
        purchaseOrderId: partialPO.id,
        supplierId: firstSupplier.id,
        receivedById: mdUser.id,
        receiptDate: new Date(),
        createdById: mdUser.id,
      },
    });
    const item = partialPOItems[0];
    await prisma.goodsReceiptItem.create({
      data: { goodsReceiptId: gr.id, purchaseOrderItemId: item.id, receivedQuantity: "3" },
    });
    await prisma.purchaseOrderItem.update({
      where: { id: item.id },
      data: { receivedQuantity: "3", status: "partially_received" },
    });
  }
  console.log(`  ✓ Goods receipt ensured (partial delivery)`);

  // 3e. Phase 7 audit log
  await prisma.auditLog.create({
    data: {
      userId: mdUser.id,
      action: "create",
      module: "procurement",
      recordType: "seed",
      description: "LBMS Phase 7 procurement & supplier operations seeded.",
      newValue: JSON.stringify({ phase: 7, requests: TEST_REQUESTS.length, purchaseOrders: TEST_POS.length, timestamp: new Date().toISOString() }),
    },
  });
  console.log(`  ✓ Phase 7 procurement audit log entry created`);

  console.log("\n✅ Phase 7 focused seed complete.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
