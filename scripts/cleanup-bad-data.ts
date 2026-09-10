import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  // Delete items with excessively large totals (scientific notation)
  const badItems = await prisma.purchaseOrderItem.findMany({
    where: { OR: [{ quantity: { gt: 1_000_000_000 } }, { unitPrice: { gt: 1_000_000_000 } }, { total: { gt: 1_000_000_000_000 } }] },
    select: { id: true, purchaseOrderId: true, quantity: true, unitPrice: true, total: true },
  });
  console.log(`Found ${badItems.length} items with extreme values`);
  for (const item of badItems) {
    console.log(`  Deleting item ${item.id} (qty=${item.quantity}, price=${item.unitPrice}, total=${item.total})`);
    await prisma.purchaseOrderItem.delete({ where: { id: item.id } });
    // Recompute PO totals
    const items = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: item.purchaseOrderId, status: { not: "cancelled" } } });
    const subtotal = items.reduce((s, i) => s + Number(i.total.toString()) - Number(i.tax.toString()), 0);
    const tax = items.reduce((s, i) => s + Number(i.tax.toString()), 0);
    const total = items.reduce((s, i) => s + Number(i.total.toString()), 0);
    await prisma.purchaseOrder.update({
      where: { id: item.purchaseOrderId },
      data: { subtotal: subtotal.toFixed(2), tax: tax.toFixed(2), total: total.toFixed(2) },
    });
    console.log(`  → PO totals recomputed: subtotal=${subtotal}, tax=${tax}, total=${total}`);
  }
  console.log("Cleanup complete.");
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
