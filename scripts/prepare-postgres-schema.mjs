import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve("prisma/schema.prisma");
const target = resolve("prisma/schema.postgresql.prisma");
const original = readFileSync(source, "utf8");

let converted = original.replace(
  /provider\s*=\s*"sqlite"/,
  'provider = "postgresql"',
);

if (converted === original) {
  throw new Error("Could not convert Prisma datasource provider to PostgreSQL.");
}

// The production VPS uses the RHEL OpenSSL 1.1 Prisma engine.
if (!converted.includes('binaryTargets = ["native", "rhel-openssl-1.1.x"]')) {
  converted = converted.replace(
    /generator client \{\n/,
    'generator client {\n  binaryTargets = ["native", "rhel-openssl-1.1.x"]\n',
  );
}

writeFileSync(target, converted, "utf8");
console.log(`Prepared ${target}`);
console.log("PostgreSQL datasource and RHEL OpenSSL Prisma binary target configured.");
