import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const u = await prisma.user.findUnique({ where: { email: "md@phase7.test" } });
  console.log("md@phase7.test exists:", !!u, "status:", u?.status);
  if (!u) {
    console.log("Recreating RBAC users...");
  }
}
main().finally(() => prisma.$disconnect());
