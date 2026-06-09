#!/usr/bin/env tsx
/**
 * backfill-finish-seconds.ts
 *
 * One-off script to populate finishSeconds on all Athlete rows that were
 * ingested before the field was added. Computes the value as the sum of
 * timeSeconds across all non-finish AthleteSegment rows for each athlete.
 *
 * Safe to re-run — athletes with an existing finishSeconds are skipped.
 *
 * Usage (run from the app/ directory):
 *   npx tsx scripts/backfill-finish-seconds.ts
 *
 * Against production:
 *   DATABASE_URL=<prod-url> npx tsx scripts/backfill-finish-seconds.ts
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

async function main() {
  // Get IDs of athletes missing finishSeconds
  const athletes = await prisma.athlete.findMany({
    where: { finishSeconds: null },
    select: { id: true },
  });

  console.log(`Found ${athletes.length} athletes missing finishSeconds.`);
  if (athletes.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let updated = 0;
  let skipped = 0;
  const BATCH = 500;

  for (let i = 0; i < athletes.length; i += BATCH) {
    const batch = athletes.slice(i, i + BATCH);
    const ids = batch.map((a) => a.id);

    // Fetch segments for this batch separately to avoid deep nesting
    const segments = await prisma.athleteSegment.findMany({
      where: {
        athleteId: { in: ids },
        segment: { isFinish: false },
      },
      select: { athleteId: true, timeSeconds: true },
    });

    // Group timeSeconds by athleteId
    const timesByAthlete = new Map<number, (number | null)[]>();
    for (const s of segments) {
      const existing = timesByAthlete.get(s.athleteId) ?? [];
      existing.push(s.timeSeconds);
      timesByAthlete.set(s.athleteId, existing);
    }

    await Promise.all(
      ids.map((id) => {
        const times = timesByAthlete.get(id) ?? [];
        // Skip if no segments or any leg time is missing
        if (times.length === 0 || times.some((t) => t === null)) {
          skipped++;
          return Promise.resolve();
        }
        const finishSeconds = Math.round(times.reduce((sum, t) => sum! + t!, 0)!);
        updated++;
        return prisma.athlete.update({
          where: { id },
          data: { finishSeconds },
        });
      })
    );

    process.stdout.write(`  ${i + batch.length}/${athletes.length} processed\r`);
  }

  console.log(`\nDone. ${updated} updated, ${skipped} skipped (incomplete segment times).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
