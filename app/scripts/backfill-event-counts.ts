#!/usr/bin/env tsx
/**
 * backfill-event-counts.ts
 *
 * One-off script to populate finisherCount and totalCount on all Event rows
 * that were ingested before the fields were added.
 *
 * Safe to re-run — all events are updated (counts are always recomputed from
 * the current athlete rows, so re-running after a re-ingest is harmless).
 *
 * Usage (run from the app/ directory):
 *   npx tsx scripts/backfill-event-counts.ts
 *
 * Against production:
 *   DATABASE_URL=<prod-url> npx tsx scripts/backfill-event-counts.ts
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
  const events = await prisma.event.findMany({
    select: { id: true, raceId: true, year: true },
    orderBy: [{ raceId: "asc" }, { year: "asc" }],
  });

  console.log(`Found ${events.length} events to update.`);

  for (const event of events) {
    const [finisherCount, totalCount] = await Promise.all([
      prisma.athlete.count({ where: { eventId: event.id, status: "FIN" } }),
      prisma.athlete.count({ where: { eventId: event.id } }),
    ]);
    await prisma.event.update({
      where: { id: event.id },
      data: { finisherCount, totalCount },
    });
    console.log(`  Event ${event.id} (year ${event.year}): ${finisherCount} finishers / ${totalCount} total`);
  }

  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
