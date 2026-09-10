import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  // Delete all sales test data to start fresh
  await prisma.customerPayment.deleteMany({});
  await prisma.invoiceItem.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.salesOrderItem.deleteMany({});
  await prisma.salesOrder.deleteMany({});
  await prisma.quoteItem.deleteMany({});
  await prisma.quote.deleteMany({});
  // Reset counter
  await prisma.salesRefCounter.deleteMany({});
  console.log("✓ Sales data cleared");
}
main().finally(() => prisma.$disconnect());
