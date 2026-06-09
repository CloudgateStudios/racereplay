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
    by: ["gender"],
    _count: { gender: true },
    orderBy: { _count: { gender: "desc" } },
  });
  console.table(results.map((r) => ({ gender: r.gender, count: r._count.gender })));
}

main().finally(() => prisma.$disconnect());
