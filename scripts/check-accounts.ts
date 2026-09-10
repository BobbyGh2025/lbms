import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const ledger = await prisma.ledgerAccount.findMany({ select: { code: true, name: true, accountClass: true, accountType: true, deletedAt: true } });
  console.log("Ledger accounts:");
  for (const a of ledger) console.log(`  ${a.code} | ${a.name} | class=${a.accountClass} | type=${a.accountType} | deleted=${!!a.deletedAt}`);
  const fin = await prisma.financialAccount.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true, accountType: true } });
  console.log("\nFinancial accounts:");
  for (const a of fin) console.log(`  ${a.code} | ${a.name} | type=${a.accountType} | id=${a.id}`);
  // Check transaction types
  const { TRANSACTION_TYPES } = await import("@prisma/client");
  console.log("\nTransaction types:", TRANSACTION_TYPES);
}
main().finally(() => prisma.$disconnect());
