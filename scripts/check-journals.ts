import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.journal.count();
  console.log("Total journals:", count);
  const byType = await prisma.journal.groupBy({ by: ["transactionType"], _count: true });
  console.log("By type:", byType);
  const byStatus = await prisma.journal.groupBy({ by: ["status"], _count: true });
  console.log("By status:", byStatus);
  const sample = await prisma.journal.findFirst({ select: { transactionDate: true, status: true, transactionType: true, amount: true } });
  console.log("Sample journal:", sample);
}
main().finally(() => prisma.$disconnect());
