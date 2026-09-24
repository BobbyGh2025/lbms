import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve("prisma/schema.prisma");
const target = resolve("prisma/schema.postgresql.prisma");
const original = readFileSync(source, "utf8");

const converted = original.replace(
  /provider\s*=\s*"sqlite"/,
  'provider = "postgresql"',
);

if (converted === original) {
  throw new Error("Could not convert Prisma datasource provider to PostgreSQL.");
}

writeFileSync(target, converted, "utf8");
console.log(`Prepared ${target}`);
