import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  // Find ALL ledger accounts that could be AP-related
  const allLedgers = await prisma.ledgerAccount.findMany({
    where: { OR: [
      { code: { contains: "AP" } },
      { code: { contains: "PAYABLE" } },
      { code: { contains: "PAY" } },
      { name: { contains: "Payable" } },
      { name: { contains: "payable" } },
    ]},
    select: { id: true, code: true, name: true, accountClass: true, accountType: true, deletedAt: true },
  });
  console.log("=== ALL AP-related ledger accounts ===");
  for (const a of allLedgers) {
    console.log(`  ${a.code} | ${a.name} | class=${a.accountClass} | type=${a.accountType} | deleted=${!!a.deletedAt} | id=${a.id}`);
  }

  // Check which account is used in Phase 11 code
  console.log("\n=== AP account resolution in Phase 11 code ===");
  const fs = await import("fs");
  const files = [
    "src/app/api/payables/bills/[id]/post/route.ts",
    "src/app/api/payables/bills/[id]/void/route.ts",
    "src/app/api/payables/payments/[id]/post/route.ts",
    "src/app/api/payables/payments/[id]/void/route.ts",
    "src/app/api/expenses/[id]/post/route.ts",
    "src/app/api/expenses/[id]/void/route.ts",
  ];
  for (const f of files) {
    try {
      const content = fs.readFileSync(f, "utf8");
      const matches = content.match(/code:\s*"[^"]*AP[^"]*"/g) || content.match(/code:\s*"[^"]*EXP[^"]*"/g) || [];
      console.log(`  ${f}: ${matches.join(", ") || "(none found)"}`);
    } catch { console.log(`  ${f}: FILE NOT FOUND`); }
  }
}
main().finally(() => prisma.$disconnect());
