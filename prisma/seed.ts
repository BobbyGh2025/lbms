/**
 * LBMS Phase 1 Seed Script
 * ------------------------
 * Seeds the foundation data:
 *  - Default permission catalogue (module x action)
 *  - System roles (MD, Administrator, Finance Manager, Operations Manager,
 *    HR Manager, Project Manager, Employee)
 *  - Role -> permission assignments
 *  - Default departments & positions
 *  - Default company settings (GHS)
 *  - Default MD employee + MD user (email: md@lightworld.tech / password: Lightworld@2025)
 *  - Default admin user (email: admin@lightworld.tech / password: Admin@2025)
 *  - A welcome notification for both users
 *
 * Run with: `bun run db:seed`
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Permission catalogue
// ---------------------------------------------------------------------------
type Action =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "approve"
  | "export"
  | "post"
  | "void"
  | "reverse"
  | "manage_accounts"
  | "manage_categories"
  | "view_reports"
  | "manage_opening_balances";

const MODULES: { module: string; label: string }[] = [
  { module: "dashboard", label: "Executive Dashboard" },
  { module: "finance", label: "Finance (Income & Expenditure)" },
  { module: "accounts", label: "Cash & Bank Accounts" },
  { module: "budgets", label: "Budgets" },
  { module: "receivables", label: "Accounts Receivable" },
  { module: "payables", label: "Accounts Payable" },
  { module: "staff", label: "Staff Management" },
  { module: "departments", label: "Departments & Positions" },
  { module: "tasks", label: "Staff Tasks" },
  { module: "customers", label: "Customers (CRM)" },
  { module: "suppliers", label: "Suppliers" },
  { module: "projects", label: "Projects" },
  { module: "pipeline", label: "Project Pipeline" },
  { module: "operations", label: "Operations" },
  { module: "decisions", label: "MD Decision Log" },
  { module: "approvals", label: "Approval System" },
  { module: "assets", label: "Asset Management" },
  { module: "documents", label: "Document Management" },
  { module: "reports", label: "Reports" },
  { module: "settings", label: "Company Settings" },
  { module: "users", label: "User Management" },
  { module: "roles", label: "Roles & Permissions" },
  { module: "audit", label: "Audit Trail" },
  { module: "notifications", label: "Notifications" },
  { module: "backup", label: "Backup & Recovery" },
];

const ACTIONS: Action[] = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "export",
  // Phase 2 finance-specific actions (also valid on other modules where ignored)
  "post",
  "void",
  "reverse",
  "manage_accounts",
  "manage_categories",
  "view_reports",
  "manage_opening_balances",
];

// ---------------------------------------------------------------------------
// Role definitions (name -> friendly description and permission policy)
// ---------------------------------------------------------------------------
type RoleDef = {
  name: string;
  displayName: string;
  description: string;
  // "*" => all permissions; otherwise a map of module -> allowed actions
  policy: "*" | Record<string, Action[]>;
};

const ROLES: RoleDef[] = [
  {
    name: "md",
    displayName: "Managing Director",
    description: "Full access to every module and all data.",
    policy: "*",
  },
  {
    name: "administrator",
    displayName: "Administrator",
    description: "System administration: users, roles, settings, backup. Restricted financial authoring.",
    policy: {
      dashboard: ["view", "export"],
      settings: ["view", "create", "edit"],
      users: ["view", "create", "edit", "delete"],
      roles: ["view", "create", "edit", "delete"],
      departments: ["view", "create", "edit", "delete"],
      staff: ["view", "create", "edit", "delete", "export"],
      audit: ["view", "export"],
      notifications: ["view"],
      backup: ["view", "create"],
      documents: ["view", "create", "edit", "delete", "export"],
      assets: ["view", "create", "edit", "delete", "export"],
    },
  },
  {
    name: "finance_manager",
    displayName: "Finance Manager",
    description: "Finance, budgets, receivables, payables and financial reports.",
    policy: {
      dashboard: ["view", "export"],
      finance: ["view", "create", "edit", "export", "post", "void", "reverse", "manage_accounts", "manage_categories", "view_reports", "manage_opening_balances"],
      accounts: ["view", "create", "edit", "export", "manage_accounts"],
      budgets: ["view", "create", "edit", "export"],
      receivables: ["view", "create", "edit", "export"],
      payables: ["view", "create", "edit", "export"],
      reports: ["view", "export"],
      approvals: ["view", "approve"],
      notifications: ["view"],
    },
  },
  {
    name: "operations_manager",
    displayName: "Operations Manager",
    description: "Operations, projects, tasks and operational reports.",
    policy: {
      dashboard: ["view"],
      finance: ["view", "view_reports"],
      operations: ["view", "create", "edit", "delete", "export"],
      projects: ["view", "create", "edit", "export"],
      pipeline: ["view", "create", "edit", "export"],
      tasks: ["view", "create", "edit", "delete"],
      staff: ["view"],
      customers: ["view", "create", "edit", "export"],
      suppliers: ["view", "create", "edit", "export"],
      approvals: ["view", "approve"],
      notifications: ["view"],
    },
  },
  {
    name: "hr_manager",
    displayName: "HR / Staff Manager",
    description: "Staff, departments, positions and HR reports.",
    policy: {
      dashboard: ["view"],
      staff: ["view", "create", "edit", "delete", "export"],
      departments: ["view", "create", "edit", "delete"],
      tasks: ["view", "create", "edit", "delete"],
      reports: ["view", "export"],
      notifications: ["view"],
    },
  },
  {
    name: "project_manager",
    displayName: "Project Manager",
    description: "Projects, project finances and project reports.",
    policy: {
      dashboard: ["view"],
      projects: ["view", "create", "edit", "export"],
      pipeline: ["view", "create", "edit"],
      tasks: ["view", "create", "edit"],
      customers: ["view", "create", "edit"],
      reports: ["view", "export"],
      notifications: ["view"],
    },
  },
  {
    name: "employee",
    displayName: "Employee",
    description: "Limited access: own tasks, documents and notifications only.",
    policy: {
      dashboard: ["view"],
      tasks: ["view"],
      documents: ["view"],
      notifications: ["view"],
    },
  },
];

// ---------------------------------------------------------------------------
// Departments & positions
// ---------------------------------------------------------------------------
const DEPARTMENTS: { name: string; code: string; description: string; positions: string[] }[] = [
  { name: "Management", code: "MGMT", description: "Executive management office.", positions: ["Managing Director", "Executive Assistant"] },
  { name: "Finance", code: "FIN", description: "Accounting, treasury and financial control.", positions: ["Finance Manager", "Accountant", "Finance Officer"] },
  { name: "Operations", code: "OPS", description: "Daily operations and service delivery.", positions: ["Operations Manager", "Operations Officer", "Field Technician"] },
  { name: "Sales", code: "SAL", description: "Sales and business development.", positions: ["Sales Manager", "Sales Executive"] },
  { name: "Marketing", code: "MKT", description: "Marketing and brand communications.", positions: ["Marketing Manager", "Marketing Officer"] },
  { name: "Technical", code: "TECH", description: "Engineering, IT and technical delivery.", positions: ["Technical Lead", "Engineer", "Technician"] },
  { name: "Administration", code: "ADMIN", description: "Administration and support services.", positions: ["Administrator", "Receptionist", "Office Assistant"] },
];

async function main() {
  console.log("🌱 Seeding LBMS Phase 1 foundation data...");

  // 1. Permissions ------------------------------------------------------------
  const permissionMap = new Map<string, { id: string; module: string; action: string }>();
  for (const { module, label } of MODULES) {
    for (const action of ACTIONS) {
      const perm = await prisma.permission.upsert({
        where: { module_action: { module, action } },
        update: { description: `${label} — ${action}` },
        create: { module, action, description: `${label} — ${action}` },
      });
      permissionMap.set(`${module}:${action}`, { id: perm.id, module, action });
    }
  }
  console.log(`  ✓ ${permissionMap.size} permissions ensured`);

  // 2. Roles + role permissions ----------------------------------------------
  const roleMap = new Map<string, string>();
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { displayName: r.displayName, description: r.description, isSystem: true },
      create: {
        name: r.name,
        displayName: r.displayName,
        description: r.description,
        isSystem: true,
      },
    });
    roleMap.set(r.name, role.id);

    // Determine permissions for this role
    let selected: { module: string; action: Action }[] = [];
    if (r.policy === "*") {
      for (const { module } of MODULES) for (const action of ACTIONS) selected.push({ module, action });
    } else {
      for (const [module, acts] of Object.entries(r.policy)) {
        for (const action of acts) selected.push({ module, action });
      }
    }

    // Clear existing role permissions then re-create (simple & idempotent)
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const { module, action } of selected) {
      const p = permissionMap.get(`${module}:${action}`)!;
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: p.id },
      });
    }
  }
  console.log(`  ✓ ${roleMap.size} system roles ensured with permissions`);

  // 3. Departments & positions -----------------------------------------------
  let deptCount = 0;
  let posCount = 0;
  for (const d of DEPARTMENTS) {
    const dept = await prisma.department.upsert({
      where: { name: d.name },
      update: { code: d.code, description: d.description, status: "active" },
      create: { name: d.name, code: d.code, description: d.description, status: "active" },
    });
    deptCount++;
    for (const title of d.positions) {
      await prisma.position.upsert({
        where: { title },
        update: { departmentId: dept.id, status: "active" },
        create: { title, departmentId: dept.id, status: "active" },
      });
      posCount++;
    }
  }
  console.log(`  ✓ ${deptCount} departments and ${posCount} positions ensured`);

  // 4. Company settings (singleton) ------------------------------------------
  await prisma.companySetting.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      companyName: "Lightworld Tech",
      legalName: "Lightworld Tech Ltd",
      address: "Accra",
      city: "Accra",
      region: "Greater Accra",
      country: "Ghana",
      phone: "+233 000 000 000",
      email: "info@lightworld.tech",
      currency: "GHS",
      currencySymbol: "GH\u20B5",
      invoicePrefix: "INV-",
      invoiceStart: 1,
    },
  });
  console.log(`  ✓ Company settings ensured`);

  // 5. Default MD employee + MD user -----------------------------------------
  const managementDept = await prisma.department.findUnique({ where: { code: "MGMT" } });
  const mdPosition = await prisma.position.findUnique({ where: { title: "Managing Director" } });

  const mdEmployee = await prisma.employee.upsert({
    where: { employeeId: "LT-EMP-0001" },
    update: {},
    create: {
      employeeId: "LT-EMP-0001",
      fullName: "Lightworld Managing Director",
      gender: "male",
      phone: "+233 000 000 001",
      email: "md@lightworld.tech",
      address: "Accra, Ghana",
      departmentId: managementDept?.id,
      positionId: mdPosition?.id,
      employmentDate: new Date("2024-01-01"),
      employmentType: "full_time",
      status: "active",
    },
  });

  const mdRole = await prisma.role.findUnique({ where: { name: "md" } });
  const adminRole = await prisma.role.findUnique({ where: { name: "administrator" } });

  const mdPassword = await bcrypt.hash("Lightworld@2025", 10);
  const mdUser = await prisma.user.upsert({
    where: { email: "md@lightworld.tech" },
    update: { employeeId: mdEmployee.id },
    create: {
      email: "md@lightworld.tech",
      username: "md",
      passwordHash: mdPassword,
      employeeId: mdEmployee.id,
      status: "active",
    },
  });
  // assign MD role
  if (mdRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: mdUser.id, roleId: mdRole.id } },
      update: {},
      create: { userId: mdUser.id, roleId: mdRole.id },
    });
  }

  // Admin user (no employee record required)
  const adminPassword = await bcrypt.hash("Admin@2025", 10);
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@lightworld.tech" },
    update: {},
    create: {
      email: "admin@lightworld.tech",
      username: "admin",
      passwordHash: adminPassword,
      status: "active",
    },
  });
  if (adminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
      update: {},
      create: { userId: adminUser.id, roleId: adminRole.id },
    });
  }
  console.log(`  ✓ Default MD + Administrator users ensured`);

  // 6. Welcome notifications --------------------------------------------------
  for (const u of [mdUser, adminUser]) {
    await prisma.notification.create({
      data: {
        userId: u.id,
        title: "Welcome to Lightworld Business Management System",
        message:
          "Phase 1 foundation is live. Your default password was set during seeding. Please change it after first login.",
        type: "success",
        category: "system",
      },
    });
  }
  console.log(`  ✓ Welcome notifications created`);

  // 7. Seed audit log ---------------------------------------------------------
  await prisma.auditLog.create({
    data: {
      userId: mdUser.id,
      action: "create",
      module: "system",
      recordType: "seed",
      description: "LBMS Phase 1 foundation data seeded (roles, permissions, departments, positions, settings, default users).",
      newValue: JSON.stringify({ phase: 1, timestamp: new Date().toISOString() }),
    },
  });
  console.log(`  ✓ Seed audit log entry created`);

  // ===========================================================================
  // PHASE 2 — FINANCE FOUNDATION SEED
  // ===========================================================================
  console.log("\n  --- Phase 2: Finance Foundation ---");

  // 8. Financial accounts (where money lives) --------------------------------
  const FIN_ACCOUNTS: { code: string; name: string; accountType: string; openingBalance: number; bankName?: string }[] = [
    { code: "CASH-001", name: "Cash on Hand", accountType: "asset", openingBalance: 2000 },
    { code: "PETTY-001", name: "Petty Cash", accountType: "asset", openingBalance: 1000 },
    { code: "BANK-001", name: "Business Bank Account", accountType: "asset", openingBalance: 50000, bankName: "GCB Bank" },
    { code: "MOMO-001", name: "MTN Mobile Money", accountType: "asset", openingBalance: 5000 },
    { code: "MOMO-002", name: "Telecel Cash", accountType: "asset", openingBalance: 0 },
  ];
  for (const a of FIN_ACCOUNTS) {
    await prisma.financialAccount.upsert({
      where: { code: a.code },
      update: {},
      create: {
        code: a.code,
        name: a.name,
        accountType: a.accountType,
        currency: "GHS",
        openingBalance: a.openingBalance,
        status: "active",
        bankName: a.bankName ?? null,
        createdById: mdUser.id,
      },
    });
  }
  console.log(`  ✓ ${FIN_ACCOUNTS.length} financial accounts ensured`);

  // 9. Chart of accounts (ledger categories) ---------------------------------
  // accountClass: asset | liability | equity | income | expense
  // accountType mirrors the class for simple lookup.
  const LEDGER_ACCOUNTS: { code: string; name: string; accountClass: string; accountType: string }[] = [
    // Asset-type ledger accounts (mirror the financial accounts for balance tracking)
    { code: "AST-CASH", name: "Cash & Equivalents", accountClass: "asset", accountType: "asset" },
    { code: "AST-BANK", name: "Bank Balances", accountClass: "asset", accountType: "asset" },
    { code: "AST-MOMO", name: "Mobile Money Balances", accountClass: "asset", accountType: "asset" },
    { code: "AST-AR", name: "Accounts Receivable", accountClass: "asset", accountType: "asset" },
    // Income categories
    { code: "INC-SALES", name: "Product Sales", accountClass: "income", accountType: "income" },
    { code: "INC-SERVICE", name: "Service Revenue", accountClass: "income", accountType: "income" },
    { code: "INC-PROJECT", name: "Project Revenue", accountClass: "income", accountType: "income" },
    { code: "INC-CONSULT", name: "Consulting", accountClass: "income", accountType: "income" },
    { code: "INC-INSTALL", name: "Installation", accountClass: "income", accountType: "income" },
    { code: "INC-MAINT", name: "Maintenance Contracts", accountClass: "income", accountType: "income" },
    { code: "INC-OTHER", name: "Other Income", accountClass: "income", accountType: "income" },
    // Expense categories
    { code: "EXP-SALARY", name: "Salaries", accountClass: "expense", accountType: "expense" },
    { code: "EXP-TRANSPORT", name: "Transport", accountClass: "expense", accountType: "expense" },
    { code: "EXP-FUEL", name: "Fuel", accountClass: "expense", accountType: "expense" },
    { code: "EXP-UTIL", name: "Utilities", accountClass: "expense", accountType: "expense" },
    { code: "EXP-RENT", name: "Rent", accountClass: "expense", accountType: "expense" },
    { code: "EXP-INTERNET", name: "Internet", accountClass: "expense", accountType: "expense" },
    { code: "EXP-OFFICE", name: "Office Supplies", accountClass: "expense", accountType: "expense" },
    { code: "EXP-MAINT", name: "Repairs & Maintenance", accountClass: "expense", accountType: "expense" },
    { code: "EXP-MKTG", name: "Marketing", accountClass: "expense", accountType: "expense" },
    { code: "EXP-PROF", name: "Professional Services", accountClass: "expense", accountType: "expense" },
    { code: "EXP-PROJ", name: "Project Expenses", accountClass: "expense", accountType: "expense" },
    { code: "EXP-BANK", name: "Bank Charges", accountClass: "expense", accountType: "expense" },
    { code: "EXP-OTHER", name: "Other Expenses", accountClass: "expense", accountType: "expense" },
    // Liabilities (stub for Phase 3 AP)
    { code: "LIB-AP", name: "Accounts Payable", accountClass: "liability", accountType: "liability" },
    { code: "LIB-LOAN", name: "Loans", accountClass: "liability", accountType: "liability" },
    // Equity (stub)
    { code: "EQT-OWNER", name: "Owner's Equity", accountClass: "equity", accountType: "equity" },
    { code: "EQT-RETAIN", name: "Retained Earnings", accountClass: "equity", accountType: "equity" },
  ];
  for (const la of LEDGER_ACCOUNTS) {
    await prisma.ledgerAccount.upsert({
      where: { code: la.code },
      update: {},
      create: {
        code: la.code,
        name: la.name,
        accountClass: la.accountClass,
        accountType: la.accountType,
        currency: "GHS",
        status: "active",
        isSystem: true,
        createdById: mdUser.id,
      },
    });
  }
  console.log(`  ✓ ${LEDGER_ACCOUNTS.length} ledger accounts (chart of accounts) ensured`);

  // 10. Post opening balances as OPENING_BALANCE journals (audit + atomic) --
  // The seed creates these directly (it's a bootstrap script that predates
  // the posting engine). To keep the reference counter in sync, we create
  // the OPB counter row with nextNumber set past the seeded journals.
  const openingDate = new Date(new Date().getFullYear(), 0, 1); // Jan 1 this year
  let openingCount = 0;
  for (const a of FIN_ACCOUNTS) {
    if (a.openingBalance <= 0) continue;
    // Debit the financial account (asset increases with debit), credit equity.
    const ref = `OPB-${new Date().getFullYear()}-${String(openingCount + 1).padStart(6, "0")}`;
    await prisma.journal.create({
      data: {
        reference: ref,
        transactionType: "opening_balance",
        status: "posted",
        transactionDate: openingDate,
        description: `Opening balance for ${a.name}`,
        financialAccountId: (await prisma.financialAccount.findUnique({ where: { code: a.code } }))!.id,
        ledgerAccountId: (await prisma.ledgerAccount.findUnique({ where: { code: "EQT-OWNER" } }))!.id,
        amount: a.openingBalance,
        currency: "GHS",
        createdById: mdUser.id,
        postedAt: new Date(),
        entries: {
          create: [
            {
              financialAccountId: (await prisma.financialAccount.findUnique({ where: { code: a.code } }))!.id,
              ledgerAccountId: (await prisma.ledgerAccount.findUnique({ where: { code: "AST-CASH" } }))!.id,
              debit: a.openingBalance,
              credit: 0,
              currency: "GHS",
              description: `Opening balance — ${a.name}`,
            },
            {
              // Equity credit — no financial account (not cash).
              ledgerAccountId: (await prisma.ledgerAccount.findUnique({ where: { code: "EQT-OWNER" } }))!.id,
              debit: 0,
              credit: a.openingBalance,
              currency: "GHS",
              description: `Opening equity — ${a.name}`,
            },
          ],
        },
      },
    });
    openingCount++;
  }
  console.log(`  ✓ ${openingCount} opening-balance journals posted`);

  // 10b. Sync the OPB reference counter so the posting engine doesn't
  // collide with seeded references. nextNumber is set to openingCount + 1
  // (the next OPB reference the engine will generate).
  await prisma.financeRefCounter.upsert({
    where: { prefix_year: { prefix: "OPB", year: new Date().getFullYear() } },
    update: { nextNumber: openingCount + 1 },
    create: { prefix: "OPB", year: new Date().getFullYear(), nextNumber: openingCount + 1 },
  });
  console.log(`  ✓ OPB reference counter synced to ${openingCount + 1}`);

  // 11. Finance seed audit log ------------------------------------------------
  await prisma.auditLog.create({
    data: {
      userId: mdUser.id,
      action: "create",
      module: "finance",
      recordType: "seed",
      description: "LBMS Phase 2 finance foundation seeded (financial accounts, chart of accounts, opening balances).",
      newValue: JSON.stringify({
        phase: 2,
        accounts: FIN_ACCOUNTS.length,
        ledgerAccounts: LEDGER_ACCOUNTS.length,
        openingJournals: openingCount,
        timestamp: new Date().toISOString(),
      }),
    },
  });
  console.log(`  ✓ Phase 2 finance audit log entry created`);

  console.log("\n✅ Phase 2 finance seed complete.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
