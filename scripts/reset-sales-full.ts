import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  // Delete all sales test data
  await prisma.customerPayment.deleteMany({});
  await prisma.invoiceItem.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.salesOrderItem.deleteMany({});
  await prisma.salesOrder.deleteMany({});
  await prisma.quoteItem.deleteMany({});
  await prisma.quote.deleteMany({});
  await prisma.salesRefCounter.deleteMany({});
  // Delete journals created by sales tests (income type with AST-AR or INC-SALES references)
  // These are orphaned after the sales records are deleted
  const arLedger = await prisma.ledgerAccount.findFirst({ where: { code: "AST-AR" } });
  const revLedger = await prisma.ledgerAccount.findFirst({ where: { code: "INC-SALES" } });
  if (arLedger || revLedger) {
    const journalIds = new Set<string>();
    const entries = await prisma.journalEntry.findMany({
      where: { OR: [
        ...(arLedger ? [{ ledgerAccountId: arLedger.id }] : []),
        ...(revLedger ? [{ ledgerAccountId: revLedger.id }] : []),
      ]},
      select: { journalId: true },
    });
    for (const e of entries) journalIds.add(e.journalId);
    if (journalIds.size > 0) {
      await prisma.journalEntry.deleteMany({ where: { journalId: { in: [...journalIds] } } });
      await prisma.journal.deleteMany({ where: { id: { in: [...journalIds] } } });
    }
  }
  console.log("✓ Sales data + orphaned finance journals cleared");
}
main().finally(() => prisma.$disconnect());
