// Phase 12 focused seed: budget permissions + test data.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Phase 12 focused seed — budget permissions + test data\n");

  // 1. Ensure budget permissions
  const budgetActions = ["view", "create", "edit", "submit", "approve", "lock", "cancel", "export"];
  for (const action of budgetActions) {
    const existing = await prisma.permission.findUnique({ where: { module_action: { module: "budgets", action } } });
    if (!existing) await prisma.permission.create({ data: { module: "budgets", action, description: `Budgets: ${action}` } });
  }
  console.log(`  ✓ ${budgetActions.length} budget permissions ensured`);

  // 2. Assign permissions to roles
  const ROLE_POLICIES: Record<string, string[]> = {
    md: budgetActions,
    administrator: ["view", "create", "edit", "submit", "export"],
    finance_manager: budgetActions,
    operations_manager: ["view", "create", "edit", "submit", "export"],
    hr_manager: ["view"],
    project_manager: ["view", "create", "edit", "submit"],
    employee: [],
  };

  for (const [roleName, actions] of Object.entries(ROLE_POLICIES)) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) continue;
    for (const action of actions) {
      const perm = await prisma.permission.findUnique({ where: { module_action: { module: "budgets", action } } });
      if (!perm) continue;
      const existing = await prisma.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } } });
      if (!existing) await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    }
  }
  console.log(`  ✓ Budget permissions assigned to roles`);

  // 3. Test data — skip if already exists
  const existingBudgets = await prisma.budget.count();
  if (existingBudgets > 0) {
    console.log(`  ✓ Budget test data already exists (${existingBudgets} budgets) — skipping`);
    console.log("\n✅ Phase 12 focused seed complete.");
    return;
  }

  const mdUser = await prisma.user.findFirst({ where: { email: "md@phase7.test" } });
  if (!mdUser) throw new Error("MD user not found");

  const year = new Date().getFullYear();
  const fyStart = new Date(year, 0, 1);
  const fyEnd = new Date(year, 11, 31, 23, 59, 59, 999);

  // Create an approved budget with lines
  const counter = await prisma.budgetRefCounter.upsert({
    where: { prefix_year: { prefix: "BUD", year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix: "BUD", year, nextNumber: 2 },
  });
  const budgetNum = `BUD-${year}-${String(counter.nextNumber - 1).padStart(6, "0")}`;

  const departments = await prisma.department.findMany({ where: { deletedAt: null, status: "active" }, take: 2 });
  const projects = await prisma.project.findMany({ where: { deletedAt: null, status: "active" }, take: 1 });

  const budget = await prisma.budget.create({
    data: {
      budgetNumber: budgetNum,
      name: `FY${year} Operating Budget`,
      description: `Annual operating budget for fiscal year ${year}`,
      fiscalYear: year,
      startDate: fyStart,
      endDate: fyEnd,
      status: "approved",
      version: 1,
      currency: "GHS",
      totalAmount: "180000.00",
      submittedAt: new Date(Date.now() - 7 * 86400000),
      submittedById: mdUser.id,
      approvedAt: new Date(Date.now() - 3 * 86400000),
      approvedById: mdUser.id,
      
      updatedById: mdUser.id,
    },
  });

  // Revenue budget lines (INC-SALES) — 100,000 annual, spread monthly
  for (let m = 1; m <= 12; m++) {
    await prisma.budgetLine.create({
      data: {
        budgetId: budget.id,
        ledgerAccountCode: "INC-SALES",
        accountClass: "income",
        month: m,
        amount: "8333.33",
        
      },
    });
  }

  // Expense budget lines — 60,000 annual
  // EXP-RENT: 12,000/year (1,000/month)
  for (let m = 1; m <= 12; m++) {
    await prisma.budgetLine.create({
      data: {
        budgetId: budget.id,
        ledgerAccountCode: "EXP-RENT",
        accountClass: "expense",
        month: m,
        amount: "1000.00",
        departmentId: departments[0]?.id ?? null,
        
      },
    });
  }

  // EXP-SALARY: 36,000/year (3,000/month)
  for (let m = 1; m <= 12; m++) {
    await prisma.budgetLine.create({
      data: {
        budgetId: budget.id,
        ledgerAccountCode: "EXP-SALARY",
        accountClass: "expense",
        month: m,
        amount: "3000.00",
        departmentId: departments[0]?.id ?? null,
        
      },
    });
  }

  // EXP-UTIL: 12,000/year (1,000/month) — with project linkage
  for (let m = 1; m <= 12; m++) {
    await prisma.budgetLine.create({
      data: {
        budgetId: budget.id,
        ledgerAccountCode: "EXP-UTIL",
        accountClass: "expense",
        month: m,
        amount: "1000.00",
        projectId: projects[0]?.id ?? null,
        
      },
    });
  }

  console.log(`  ✓ Approved budget ${budgetNum} created (revenue 100k + expenses 60k + utilities 12k)`);
  console.log(`  ✓ ${12 * 4} budget lines created (4 accounts × 12 months)`);

  // Create a draft budget (for testing lifecycle)
  const draftCounter = await prisma.budgetRefCounter.upsert({
    where: { prefix_year: { prefix: "BUD", year } },
    update: { nextNumber: { increment: 1 } },
    create: { prefix: "BUD", year, nextNumber: 3 },
  });
  const draftNum = `BUD-${year}-${String(draftCounter.nextNumber - 1).padStart(6, "0")}`;
  await prisma.budget.create({
    data: {
      budgetNumber: draftNum,
      name: `FY${year} Draft Budget`,
      fiscalYear: year,
      startDate: fyStart,
      endDate: fyEnd,
      status: "draft",
      version: 1,
      
      updatedById: mdUser.id,
    },
  });
  console.log(`  ✓ Draft budget ${draftNum} created`);

  // Audit log
  await prisma.auditLog.create({
    data: {
      userId: mdUser.id,
      action: "create",
      module: "budgets",
      recordType: "seed",
      description: "LBMS Phase 12 budgeting & forecasting seeded.",
      newValue: JSON.stringify({ phase: 12, budgets: 2, lines: 48, timestamp: new Date().toISOString() }),
    },
  });
  console.log(`  ✓ Phase 12 audit log entry created`);

  console.log("\n✅ Phase 12 focused seed complete.");
}

main().catch(e => { console.error("Seed failed:", e); process.exit(1); }).finally(() => prisma.$disconnect());
