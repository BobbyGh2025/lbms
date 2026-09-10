import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  // Delete all AP/expense test data
  await prisma.expense.deleteMany({});
  await prisma.supplierPayment.deleteMany({});
  await prisma.supplierBillItem.deleteMany({});
  await prisma.supplierBill.deleteMany({});
  await prisma.payableRefCounter.deleteMany({});
  // Delete orphaned journals that reference LIB-AP or expense accounts from AP tests
  const apLedger = await prisma.ledgerAccount.findFirst({ where: { code: "LIB-AP" } });
  if (apLedger) {
    const entries = await prisma.journalEntry.findMany({ where: { ledgerAccountId: apLedger.id }, select: { journalId: true } });
    const journalIds = [...new Set(entries.map(e => e.journalId))];
    if (journalIds.length > 0) {
      await prisma.journalEntry.deleteMany({ where: { journalId: { in: journalIds } } });
      await prisma.journal.deleteMany({ where: { id: { in: journalIds } } });
    }
  }
  console.log("✓ AP/expense data + orphaned journals cleared");
}
main().finally(() => prisma.$disconnect());
