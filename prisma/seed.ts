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
type Action = "view" | "create" | "edit" | "delete" | "approve" | "export";

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

const ACTIONS: Action[] = ["view", "create", "edit", "delete", "approve", "export"];

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
      finance: ["view", "create", "edit", "delete", "export"],
      accounts: ["view", "create", "edit", "export"],
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

  console.log("\n✅ Phase 1 seed complete.");
  console.log("   MD login:       md@lightworld.tech / Lightworld@2025");
  console.log("   Admin login:    admin@lightworld.tech / Admin@2025");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
