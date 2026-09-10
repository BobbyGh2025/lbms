import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const arLedger = await prisma.ledgerAccount.findFirst({ where: { code: "AST-AR" } });
  if (!arLedger) { console.log("No AST-AR ledger"); return; }
  const entries = await prisma.journalEntry.findMany({
    where: { ledgerAccountId: arLedger.id, journal: { status: { in: ["posted", "reversed"] } } },
    select: { debit: true, credit: true, journal: { select: { reference: true, status: true, description: true } } },
    orderBy: { journal: { transactionDate: "asc" } },
  });
  let totalDr = 0, totalCr = 0;
  for (const e of entries) {
    const dr = Number(e.debit), cr = Number(e.credit);
    totalDr += dr; totalCr += cr;
    console.log(`${e.journal.reference} [${e.journal.status}] | Dr=${dr} Cr=${cr} | ${e.journal.description?.slice(0, 60)}`);
  }
  console.log(`\nTotal: Dr=${totalDr}, Cr=${totalCr}, Balance=${totalDr - totalCr}`);
}
main().finally(() => prisma.$disconnect());
