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

if (!converted.includes('binaryTargets = ["native", "rhel-openssl-1.1.x"]')) {
  converted = converted.replace(
    /generator client \{\n/,
    'generator client {\\n  binaryTargets = ["native", "rhel-openssl-1.1.x"]\\n',
  );
}

writeFileSync(target, converted, "utf8");
console.log(`Prepared ${target}`);

// CI validation: deterministic PostgreSQL schema preparation.
