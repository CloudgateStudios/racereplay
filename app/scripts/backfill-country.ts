#!/usr/bin/env tsx
/**
 * backfill-country.ts
 *
 * Normalizes Athlete.country values to consistent ISO 3166-1 alpha-2 codes.
 * Fixes known anomalies found in the audit:
 *   - 'RUS' → 'RU'  (3-letter code used by one source)
 *   - ''    → ''    (left blank — no mapping available, leave as-is)
 *
 * Safe to re-run.
 *
 * Usage (run from the app/ directory):
 *   npx tsx scripts/backfill-country.ts
 *
 * Against production:
 *   DATABASE_URL=<prod-url> npx tsx scripts/backfill-country.ts
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Known non-alpha-2 values and their corrections
const CORRECTIONS: Record<string, string> = {
  RUS: "RU",
  USA: "US",
  GBR: "GB",
  CAN: "CA",
  AUS: "AU",
  DEU: "DE",
  FRA: "FR",
  ITA: "IT",
  ESP: "ES",
  BRA: "BR",
  JPN: "JP",
  CHN: "CN",
  // Add more as new sources are ingested
};

async function main() {
  let totalFixed = 0;

  for (const [from, to] of Object.entries(CORRECTIONS)) {
    const result = await prisma.athlete.updateMany({
      where: { country: from },
      data: { country: to },
    });
    if (result.count > 0) {
      console.log(`  ${from} → ${to}: ${result.count} rows`);
      totalFixed += result.count;
    }
  }

  if (totalFixed === 0) {
    console.log("Nothing to fix — all country values are already normalized.");
  } else {
    console.log(`\nDone. ${totalFixed} rows updated.`);
  }
}

main().finally(() => prisma.$disconnect());
