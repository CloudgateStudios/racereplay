#!/usr/bin/env tsx
/**
 * backfill-normalized-names.ts
 *
 * One-off script to populate the normalizedName field on all existing
 * Athlete rows that were ingested before the field was added.
 *
 * Safe to re-run — rows with an existing normalizedName are skipped.
 *
 * Usage (run from the app/ directory):
 *   npx tsx scripts/backfill-normalized-names.ts
 *
 * Against production:
 *   DATABASE_URL=<prod-url> npx tsx scripts/backfill-normalized-names.ts
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { normalizeName } from "./ingest.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const athletes = await prisma.athlete.findMany({
    where: { normalizedName: null },
    select: { id: true, name: true },
  });

  console.log(`Found ${athletes.length} athletes missing normalizedName.`);
  if (athletes.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let updated = 0;
  const BATCH = 500;

  for (let i = 0; i < athletes.length; i += BATCH) {
    const batch = athletes.slice(i, i + BATCH);
    await Promise.all(
      batch.map((a) =>
        prisma.athlete.update({
          where: { id: a.id },
          data: { normalizedName: normalizeName(a.name) },
        })
      )
    );
    updated += batch.length;
    process.stdout.write(`  ${updated}/${athletes.length} updated\r`);
  }

  console.log(`\nDone. ${updated} athletes backfilled.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
