import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const invoices = await prisma.invoice.findMany({ where: { deletedAt: null }, select: { invoiceNumber: true, status: true, total: true, balanceDue: true, journalId: true } });
  for (const inv of invoices) {
    console.log(`${inv.invoiceNumber} | status=${inv.status} | total=${inv.total} | balance=${inv.balanceDue} | journalId=${inv.journalId ?? "NULL"}`);
  }
}
main().finally(() => prisma.$disconnect());
