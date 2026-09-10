// Phase 11 focused seed: AP/expense permissions + test data.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Phase 11 focused seed — AP/expense permissions + test data\n");

  // 1. Ensure payables + expenses permissions
  const payableActions = ["view", "create", "edit", "submit", "approve", "post", "pay", "void", "export"];
  const expenseActions = ["view", "create", "edit", "submit", "approve", "post", "void", "export"];

  for (const action of payableActions) {
    const existing = await prisma.permission.findUnique({ where: { module_action: { module: "payables", action } } });
    if (!existing) await prisma.permission.create({ data: { module: "payables", action, description: `Payables: ${action}` } });
  }
  for (const action of expenseActions) {
    const existing = await prisma.permission.findUnique({ where: { module_action: { module: "expenses", action } } });
    if (!existing) await prisma.permission.create({ data: { module: "expenses", action, description: `Expenses: ${action}` } });
  }
  console.log(`  ✓ ${payableActions.length} payables + ${expenseActions.length} expenses permissions ensured`);

  // 2. Assign permissions to roles
  const ROLE_POLICIES: Record<string, { payables: string[]; expenses: string[] }> = {
    md: { payables: payableActions, expenses: expenseActions },
    administrator: { payables: payableActions, expenses: expenseActions },
    finance_manager: { payables: payableActions, expenses: expenseActions },
    operations_manager: { payables: ["view", "create", "edit", "submit", "export"], expenses: ["view", "create", "edit", "submit", "export"] },
    hr_manager: { payables: [], expenses: ["view"] },
    project_manager: { payables: ["view"], expenses: ["view", "create", "edit", "submit"] },
    employee: { payables: [], expenses: ["view"] },
  };

  for (const [roleName, { payables, expenses }] of Object.entries(ROLE_POLICIES)) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) continue;
    for (const action of payables) {
      const perm = await prisma.permission.findUnique({ where: { module_action: { module: "payables", action } } });
      if (!perm) continue;
      const existing = await prisma.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } } });
      if (!existing) await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    }
    for (const action of expenses) {
      const perm = await prisma.permission.findUnique({ where: { module_action: { module: "expenses", action } } });
      if (!perm) continue;
      const existing = await prisma.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } } });
      if (!existing) await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    }
  }
  console.log(`  ✓ AP/expense permissions assigned to roles`);

  // 3. Test data — skip if already exists
  const existingBills = await prisma.supplierBill.count();
  if (existingBills > 0) {
    console.log(`  ✓ AP test data already exists (${existingBills} bills) — skipping`);
    console.log("\n✅ Phase 11 focused seed complete.");
    return;
  }

  const mdUser = await prisma.user.findFirst({ where: { email: "md@phase7.test" } });
  if (!mdUser) throw new Error("MD user not found");

  const suppliers = await prisma.supplier.findMany({ where: { deletedAt: null, status: "active" }, orderBy: { supplierNumber: "asc" } });
  const projects = await prisma.project.findMany({ where: { deletedAt: null, status: "active" }, take: 1 });
  const finAccounts = await prisma.financialAccount.findMany({ where: { deletedAt: null, status: "active" }, orderBy: { code: "asc" } });
  if (suppliers.length < 2 || finAccounts.length < 1) throw new Error("Need at least 2 suppliers + 1 financial account");

  const year = new Date().getFullYear();
  async function nextRef(prefix: string): Promise<string> {
    const counter = await prisma.payableRefCounter.upsert({
      where: { prefix_year: { prefix, year } },
      update: { nextNumber: { increment: 1 } },
      create: { prefix, year, nextNumber: 2 },
    });
    return `${prefix}-${year}-${String(counter.nextNumber - 1).padStart(6, "0")}`;
  }

  // 3a. Create a posted supplier bill (GHS 10,000)
  const bill1Num = await nextRef("SB");
  const bill1 = await prisma.supplierBill.create({
    data: {
      billNumber: bill1Num,
      supplierId: suppliers[0].id,
      supplierRef: "SUP-INV-001",
      projectId: projects[0]?.id ?? null,
      billDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 86400000),
      status: "posted",
      subtotal: "10000.00",
      tax: "0.00",
      total: "10000.00",
      amountPaid: "0.00",
      balanceDue: "10000.00",
      postedAt: new Date(),
      createdById: mdUser.id,
      updatedById: mdUser.id,
    },
  });
  await prisma.supplierBillItem.create({
    data: { supplierBillId: bill1.id, description: "Office equipment supply", quantity: "1", unitPrice: "10000.00", total: "10000.00", ledgerAccountCode: "EXP-OFFICE" },
  });
  console.log(`  ✓ Posted supplier bill ${bill1Num} (GHS 10,000, unpaid)`);

  // 3b. Create a partially paid bill (GHS 5,000, paid GHS 2,000)
  const bill2Num = await nextRef("SB");
  const bill2 = await prisma.supplierBill.create({
    data: {
      billNumber: bill2Num,
      supplierId: suppliers[1].id,
      supplierRef: "SUP-INV-002",
      billDate: new Date(),
      dueDate: new Date(Date.now() + 15 * 86400000),
      status: "partially_paid",
      subtotal: "5000.00",
      tax: "0.00",
      total: "5000.00",
      amountPaid: "2000.00",
      balanceDue: "3000.00",
      postedAt: new Date(),
      createdById: mdUser.id,
      updatedById: mdUser.id,
    },
  });
  await prisma.supplierBillItem.create({
    data: { supplierBillId: bill2.id, description: "Internet services", quantity: "1", unitPrice: "5000.00", total: "5000.00", ledgerAccountCode: "EXP-INTERNET" },
  });
  console.log(`  ✓ Partially-paid bill ${bill2Num} (GHS 5,000, paid GHS 2,000, balance GHS 3,000)`);

  // 3c. Create an overdue bill (GHS 8,000, 30 days overdue)
  const bill3Num = await nextRef("SB");
  const bill3 = await prisma.supplierBill.create({
    data: {
      billNumber: bill3Num,
      supplierId: suppliers[0].id,
      billDate: new Date(Date.now() - 60 * 86400000),
      dueDate: new Date(Date.now() - 30 * 86400000),
      status: "posted",
      subtotal: "8000.00",
      tax: "0.00",
      total: "8000.00",
      amountPaid: "0.00",
      balanceDue: "8000.00",
      postedAt: new Date(Date.now() - 60 * 86400000),
      createdById: mdUser.id,
      updatedById: mdUser.id,
    },
  });
  await prisma.supplierBillItem.create({
    data: { supplierBillId: bill3.id, description: "Transport services", quantity: "1", unitPrice: "8000.00", total: "8000.00", ledgerAccountCode: "EXP-TRANSPORT" },
  });
  console.log(`  ✓ Overdue bill ${bill3Num} (GHS 8,000, 30 days overdue)`);

  // 3d. Create a posted expense (GHS 1,500, direct payment)
  const exp1Num = await nextRef("EXP");
  const exp1 = await prisma.expense.create({
    data: {
      expenseNumber: exp1Num,
      ledgerAccountCode: "EXP-UTIL",
      financialAccountId: finAccounts[0].id,
      expenseDate: new Date(),
      amount: "1500.00",
      description: "Electricity bill payment",
      paymentMethod: "bank_transfer",
      status: "posted",
      postedAt: new Date(),
      createdById: mdUser.id,
    },
  });
  console.log(`  ✓ Posted expense ${exp1Num} (GHS 1,500, utilities)`);

  // 3e. Audit log
  await prisma.auditLog.create({
    data: {
      userId: mdUser.id,
      action: "create",
      module: "payables",
      recordType: "seed",
      description: "LBMS Phase 11 accounts payable & expenses seeded.",
      newValue: JSON.stringify({ phase: 11, bills: 3, expenses: 1, timestamp: new Date().toISOString() }),
    },
  });
  console.log(`  ✓ Phase 11 audit log entry created`);

  console.log("\n✅ Phase 11 focused seed complete.");
}

main().catch(e => { console.error("Seed failed:", e); process.exit(1); }).finally(() => prisma.$disconnect());
