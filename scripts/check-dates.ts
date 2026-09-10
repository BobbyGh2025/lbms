import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const invoices = await prisma.invoice.findMany({
    where: { deletedAt: null, status: { in: ["issued", "partially_paid"] } },
    select: { invoiceNumber: true, dueDate: true, balanceDue: true, status: true },
  });
  console.log("Outstanding invoices:");
  for (const inv of invoices) {
    console.log(`  ${inv.invoiceNumber} | status=${inv.status} | due=${inv.dueDate?.toISOString()} | balance=${inv.balanceDue}`);
  }
  const bills = await prisma.supplierBill.findMany({
    where: { deletedAt: null, status: { in: ["posted", "partially_paid"] } },
    select: { billNumber: true, dueDate: true, balanceDue: true, status: true },
  });
  console.log("\nOutstanding bills:");
  for (const b of bills) {
    console.log(`  ${b.billNumber} | status=${b.status} | due=${b.dueDate?.toISOString()} | balance=${b.balanceDue}`);
  }
}
main().finally(() => prisma.$disconnect());
