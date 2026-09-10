import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const arLedger = await prisma.ledgerAccount.findFirst({ where: { code: "AST-AR" } });
  const arEntries = await prisma.journalEntry.findMany({
    where: { ledgerAccountId: arLedger?.id, journal: { status: { in: ["posted", "reversed"] } } },
    select: { debit: true, credit: true },
  });
  let arBalance = 0;
  for (const e of arEntries) arBalance += Number(e.debit) - Number(e.credit);
  const invoices = await prisma.invoice.findMany({ where: { deletedAt: null, status: { not: "voided" } }, select: { balanceDue: true } });
  let opAR = 0;
  for (const inv of invoices) opAR += Number(inv.balanceDue);
  console.log("Finance AR (AST-AR ledger):", Math.round(arBalance * 100) / 100);
  console.log("Operational AR (Σ invoice.balanceDue):", Math.round(opAR * 100) / 100);
  console.log("Reconciliation:", Math.abs(arBalance - opAR) < 0.01 ? "MATCH ✓" : "MISMATCH ✗");
}
main().finally(() => prisma.$disconnect());
