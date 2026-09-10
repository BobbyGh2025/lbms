// Phase 10 focused seed: sales permissions + test data.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Phase 10 focused seed — sales permissions + test data\n");

  // 1. Ensure sales permissions
  const salesActions = ["view", "create", "edit", "submit", "approve", "issue", "pay", "void", "export"];
  for (const action of salesActions) {
    // Use upsert by finding existing or creating
    const existing = await prisma.permission.findUnique({ where: { module_action: { module: "sales", action } } });
    if (!existing) {
      await prisma.permission.create({ data: { module: "sales", action, description: `Sales: ${action}` } });
    }
  }
  console.log(`  ✓ ${salesActions.length} sales permissions ensured`);

  // 2. Assign sales permissions to roles
  const ROLE_POLICIES: Record<string, string[]> = {
    md: salesActions,
    administrator: ["view", "create", "edit", "submit", "approve", "issue", "pay", "void", "export"],
    finance_manager: ["view", "create", "edit", "submit", "approve", "issue", "pay", "void", "export"],
    operations_manager: ["view", "create", "edit", "submit", "issue", "export"],
    hr_manager: [],
    project_manager: ["view", "create", "edit", "submit", "issue"],
    employee: ["view"],
  };

  for (const [roleName, actions] of Object.entries(ROLE_POLICIES)) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) continue;
    for (const action of actions) {
      const perm = await prisma.permission.findUnique({ where: { module_action: { module: "sales", action } } });
      if (!perm) continue;
      const existing = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      });
      if (!existing) {
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
      }
    }
  }
  console.log(`  ✓ Sales permissions assigned to roles`);

  // 3. Test data — skip if already exists
  const existingQuotes = await prisma.quote.count();
  if (existingQuotes > 0) {
    console.log(`  ✓ Sales test data already exists (${existingQuotes} quotes) — skipping`);
    console.log("\n✅ Phase 10 focused seed complete.");
    return;
  }

  const mdUser = await prisma.user.findFirst({ where: { email: "md@phase7.test" } });
  if (!mdUser) throw new Error("MD user not found");

  // Fetch reference data
  const customers = await prisma.customer.findMany({ where: { deletedAt: null, status: "active" }, orderBy: { customerNumber: "asc" } });
  const projects = await prisma.project.findMany({ where: { deletedAt: null, status: "active" }, orderBy: { projectNumber: "asc" } });
  const inventoryItems = await prisma.inventoryItem.findMany({ where: { deletedAt: null, active: true }, take: 5 });

  if (customers.length === 0) throw new Error("No active customers found — run Phase 4 seed first");

  const year = new Date().getFullYear();
  const firstCustomer = customers[0];
  const secondCustomer = customers[1] || customers[0];
  const firstProject = projects[0];

  // Helper: generate sales ref number
  async function nextRef(prefix: string): Promise<string> {
    const counter = await prisma.salesRefCounter.upsert({
      where: { prefix_year: { prefix, year } },
      update: { nextNumber: { increment: 1 } },
      create: { prefix, year, nextNumber: 2 },
    });
    return `${prefix}-${year}-${String(counter.nextNumber - 1).padStart(6, "0")}`;
  }

  // 3a. Create a draft quote
  const quote1Num = await nextRef("QT");
  const quote1 = await prisma.quote.create({
    data: {
      quoteNumber: quote1Num,
      customerId: firstCustomer.id,
      projectId: firstProject?.id ?? null,
      status: "draft",
      issueDate: new Date(),
      expiryDate: new Date(Date.now() + 30 * 86400000),
      createdById: mdUser.id,
      updatedById: mdUser.id,
    },
  });
  // Add items
  if (inventoryItems.length >= 2) {
    const item1Total = { qty: "10", price: "500.00", discount: "0", taxRate: "15" };
    const sub1 = 10 * 500; const tax1 = sub1 * 0.15; const total1 = sub1 + tax1;
    await prisma.quoteItem.create({
      data: {
        quoteId: quote1.id,
        inventoryItemId: inventoryItems[0].id,
        description: inventoryItems[0].name,
        quantity: item1Total.qty,
        unitPrice: item1Total.price,
        discount: "0",
        taxRate: "15",
        tax: tax1.toFixed(2),
        total: total1.toFixed(2),
      },
    });
    const sub2 = 5 * 200; const tax2 = sub2 * 0.15; const total2 = sub2 + tax2;
    await prisma.quoteItem.create({
      data: {
        quoteId: quote1.id,
        inventoryItemId: inventoryItems[1].id,
        description: inventoryItems[1].name,
        quantity: "5",
        unitPrice: "200.00",
        discount: "0",
        taxRate: "15",
        tax: tax2.toFixed(2),
        total: total2.toFixed(2),
      },
    });
    // Recompute totals
    const items = await prisma.quoteItem.findMany({ where: { quoteId: quote1.id } });
    const subtotal = items.reduce((s, i) => s + Number(i.total.toString()) - Number(i.tax.toString()), 0);
    const tax = items.reduce((s, i) => s + Number(i.tax.toString()), 0);
    const total = items.reduce((s, i) => s + Number(i.total.toString()), 0);
    await prisma.quote.update({ where: { id: quote1.id }, data: { subtotal: subtotal.toFixed(2), tax: tax.toFixed(2), total: total.toFixed(2) } });
  }
  console.log(`  ✓ Draft quote ${quote1Num} created`);

  // 3b. Create an accepted quote (ready for conversion)
  const quote2Num = await nextRef("QT");
  const quote2 = await prisma.quote.create({
    data: {
      quoteNumber: quote2Num,
      customerId: secondCustomer.id,
      status: "accepted",
      issueDate: new Date(Date.now() - 7 * 86400000),
      expiryDate: new Date(Date.now() + 23 * 86400000),
      sentAt: new Date(Date.now() - 5 * 86400000),
      acceptedAt: new Date(),
      acceptedById: mdUser.id,
      createdById: mdUser.id,
      updatedById: mdUser.id,
    },
  });
  await prisma.quoteItem.create({
    data: { quoteId: quote2.id, description: "Consulting services", quantity: "20", unitPrice: "150.00", discount: "0", taxRate: "0", tax: "0.00", total: "3000.00" },
  });
  await prisma.quote.update({ where: { id: quote2.id }, data: { subtotal: "3000.00", tax: "0.00", total: "3000.00" } });
  console.log(`  ✓ Accepted quote ${quote2Num} created`);

  // 3c. Create a sales order
  const order1Num = await nextRef("SO");
  const order1 = await prisma.salesOrder.create({
    data: {
      orderNumber: order1Num,
      customerId: firstCustomer.id,
      projectId: firstProject?.id ?? null,
      orderDate: new Date(),
      status: "confirmed",
      confirmedAt: new Date(),
      createdById: mdUser.id,
      updatedById: mdUser.id,
    },
  });
  await prisma.salesOrderItem.create({
    data: { salesOrderId: order1.id, description: "Equipment supply", quantity: "2", unitPrice: "5000.00", discount: "0", taxRate: "15", tax: "1500.00", total: "11500.00" },
  });
  await prisma.salesOrder.update({ where: { id: order1.id }, data: { subtotal: "10000.00", tax: "1500.00", total: "11500.00" } });
  console.log(`  ✓ Sales order ${order1Num} created`);

  // 3d. Create an issued invoice
  const inv1Num = await nextRef("INV");
  const inv1 = await prisma.invoice.create({
    data: {
      invoiceNumber: inv1Num,
      customerId: firstCustomer.id,
      salesOrderId: order1.id,
      projectId: firstProject?.id ?? null,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 86400000),
      status: "issued",
      subtotal: "11500.00",
      tax: "1500.00",
      total: "13000.00",
      balanceDue: "13000.00",
      issuedAt: new Date(),
      issuedById: mdUser.id,
      createdById: mdUser.id,
      updatedById: mdUser.id,
    },
  });
  await prisma.invoiceItem.create({
    data: { invoiceId: inv1.id, description: "Equipment supply", quantity: "2", unitPrice: "5000.00", discount: "0", taxRate: "15", tax: "1500.00", total: "11500.00" },
  });
  console.log(`  ✓ Issued invoice ${inv1Num} created (GHS 13,000.00)`);

  // 3e. Create a partially-paid invoice
  const inv2Num = await nextRef("INV");
  const inv2 = await prisma.invoice.create({
    data: {
      invoiceNumber: inv2Num,
      customerId: secondCustomer.id,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 15 * 86400000),
      status: "partially_paid",
      subtotal: "3000.00",
      tax: "0.00",
      total: "3000.00",
      amountPaid: "1000.00",
      balanceDue: "2000.00",
      issuedAt: new Date(),
      issuedById: mdUser.id,
      createdById: mdUser.id,
      updatedById: mdUser.id,
    },
  });
  await prisma.invoiceItem.create({
    data: { invoiceId: inv2.id, description: "Consulting services", quantity: "20", unitPrice: "150.00", discount: "0", taxRate: "0", tax: "0.00", total: "3000.00" },
  });
  // Create a posted payment for the partial amount
  const pmt1Num = await nextRef("PMT");
  await prisma.customerPayment.create({
    data: {
      paymentNumber: pmt1Num,
      customerId: secondCustomer.id,
      invoiceId: inv2.id,
      paymentDate: new Date(),
      amount: "1000.00",
      paymentMethod: "bank_transfer",
      reference: "BANK-REF-001",
      status: "draft", // not posted to finance yet (no journal)
      createdById: mdUser.id,
    },
  });
  console.log(`  ✓ Partially-paid invoice ${inv2Num} created (GHS 3,000, paid GHS 1,000, balance GHS 2,000)`);

  // 3f. Create an overdue invoice (due date in the past)
  const inv3Num = await nextRef("INV");
  const inv3 = await prisma.invoice.create({
    data: {
      invoiceNumber: inv3Num,
      customerId: firstCustomer.id,
      issueDate: new Date(Date.now() - 60 * 86400000),
      dueDate: new Date(Date.now() - 30 * 86400000), // 30 days overdue
      status: "issued",
      subtotal: "5000.00",
      tax: "0.00",
      total: "5000.00",
      balanceDue: "5000.00",
      issuedAt: new Date(Date.now() - 60 * 86400000),
      issuedById: mdUser.id,
      createdById: mdUser.id,
      updatedById: mdUser.id,
    },
  });
  await prisma.invoiceItem.create({
    data: { invoiceId: inv3.id, description: "Software license", quantity: "1", unitPrice: "5000.00", discount: "0", taxRate: "0", tax: "0.00", total: "5000.00" },
  });
  console.log(`  ✓ Overdue invoice ${inv3Num} created (GHS 5,000, 30 days overdue)`);

  // 3g. Audit log
  await prisma.auditLog.create({
    data: {
      userId: mdUser.id,
      action: "create",
      module: "sales",
      recordType: "seed",
      description: "LBMS Phase 10 sales, quotations, invoicing & receivables seeded.",
      newValue: JSON.stringify({ phase: 10, quotes: 2, orders: 1, invoices: 3, timestamp: new Date().toISOString() }),
    },
  });
  console.log(`  ✓ Phase 10 sales audit log entry created`);

  console.log("\n✅ Phase 10 focused seed complete.");
}

main().catch(e => { console.error("Seed failed:", e); process.exit(1); }).finally(() => prisma.$disconnect());
