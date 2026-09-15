import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const empRole = await prisma.role.findUnique({ where: { name: "employee" } });
  if (!empRole) { console.log("No employee role"); return; }
  const perms = await prisma.rolePermission.findMany({
    where: { roleId: empRole.id },
    include: { permission: { select: { module: true, action: true } } },
  });
  const salesPerms = perms.filter(p => p.permission.module === "sales");
  console.log("Employee sales permissions:", salesPerms.map(p => `${p.permission.module}:${p.permission.action}`));
}
main().finally(() => prisma.$disconnect());
