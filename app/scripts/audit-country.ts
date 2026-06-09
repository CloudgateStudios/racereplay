#!/usr/bin/env tsx
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const results = await prisma.athlete.groupBy({
    by: ["country"],
    _count: { country: true },
    orderBy: { _count: { country: "desc" } },
  });
  console.log(`${results.length} distinct country values:\n`);
  console.table(results.map((r) => ({ country: r.country, count: r._count.country })));
}

main().finally(() => prisma.$disconnect());
