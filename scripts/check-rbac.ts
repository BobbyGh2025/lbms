import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const roles = await prisma.role.findMany({ select: { name: true } });
  console.log("Roles:", roles.map(r => r.name).join(", "));
  const testUsers = await prisma.user.findMany({
    where: { OR: [{ email: { contains: "@procurement.test" } }, { email: { contains: "@phase7.test" } }, { username: { startsWith: "rbac_" } }] },
    select: { email: true, username: true, status: true, userRoles: { include: { role: { select: { name: true } } } } },
  });
  console.log("Existing RBAC test users:", testUsers.length);
  for (const u of testUsers) console.log(" -", u.username, u.email, "->", u.userRoles.map(r => r.role.name).join(","));
}
main().finally(() => prisma.$disconnect());
