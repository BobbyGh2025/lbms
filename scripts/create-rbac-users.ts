import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();

const PASSWORD = "TestPass123!";
const ROLES = ["md", "administrator", "finance_manager", "operations_manager", "hr_manager", "project_manager", "employee"];

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  for (const roleName of ROLES) {
    const email = `${roleName}@phase7.test`;
    const username = `rbac_${roleName}`;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Ensure password is up to date + role assigned
      await prisma.user.update({ where: { id: existing.id }, data: { passwordHash: hash, status: "active" } });
      const role = await prisma.role.findUnique({ where: { name: roleName } });
      if (role) {
        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: existing.id, roleId: role.id } },
          update: {},
          create: { userId: existing.id, roleId: role.id },
        });
      }
      console.log(`  ✓ ${username} (${email}) — updated`);
      continue;
    }
    const user = await prisma.user.create({
      data: { email, username, passwordHash: hash, status: "active" },
    });
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (role) {
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    }
    console.log(`  ✓ ${username} (${email}) — created`);
  }
  console.log("\nAll 7 RBAC test users ready. Password:", PASSWORD);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
