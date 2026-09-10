import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const c = await prisma.user.count({ where: { email: { contains: "@phase7.test" } } });
  console.log("Phase 7 RBAC users:", c);
  const invPerms = await prisma.permission.count({ where: { module: "inventory" } });
  console.log("Inventory permissions:", invPerms);
}
main().finally(() => prisma.$disconnect());
