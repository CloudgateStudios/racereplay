#!/usr/bin/env tsx
/**
 * ingest.ts
 *
 * Reads a _passing.csv produced by analyze-passing.mjs and upserts all data
 * into the RaceReplay database via Prisma.
 *
 * Usage (run from the app/ directory):
 *   npx tsx scripts/ingest.ts <passing-csv> \
 *     --slug <slug> \
 *     --race-name "<Human Readable Name>" \
 *     --year <YYYY> \
 *     --event-type <triathlon|road_race> \
 *     --event-date <YYYY-MM-DD>
 *
 * Examples:
 *   npx tsx scripts/ingest.ts ../scripts/data/IRM-CHATTANOOGA703-2026_passing.csv \
 *     --slug im-703-chattanooga \
 *     --race-name "IM 70.3 Chattanooga" \
 *     --year 2026 \
 *     --event-type triathlon \
 *     --event-date 2026-05-18
 *
 *   npx tsx scripts/ingest.ts ../scripts/data/BASS2026_passing.csv \
 *     --slug shamrock-shuffle \
 *     --race-name "Bank of America Shamrock Shuffle" \
 *     --year 2026 \
 *     --event-type road_race \
 *     --event-date 2026-03-29
 *
 * Safe to re-run — all writes are upserts keyed on (slug, year, bib).
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

import fs from "fs/promises";
import { PrismaClient, AthleteStatus } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── Arg parsing ─────────────────────────────────────────────────────────────

interface Args {
  csvFile: string;
  slug: string;
  raceName: string;
  year: number;
  eventType: "TRIATHLON" | "ROAD_RACE";
  eventDate: Date;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const flags: Record<string, string> = {};
  let csvFile: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    } else if (!csvFile) {
      csvFile = args[i];
    }
  }

  const required = ["slug", "race-name", "year", "event-type", "event-date"];
  for (const key of required) {
    if (!flags[key]) {
      console.error(`Missing required flag: --${key}`);
      process.exit(1);
    }
  }
  if (!csvFile) {
    console.error("Missing required argument: <passing-csv>");
    process.exit(1);
  }

  const rawType = flags["event-type"].toUpperCase().replace("-", "_");
  if (rawType !== "TRIATHLON" && rawType !== "ROAD_RACE") {
    console.error(`--event-type must be triathlon or road_race`);
    process.exit(1);
  }

  return {
    csvFile: path.resolve(csvFile),
    slug: flags["slug"],
    raceName: flags["race-name"],
    year: parseInt(flags["year"], 10),
    eventType: rawType as "TRIATHLON" | "ROAD_RACE",
    eventDate: new Date(flags["event-date"]),
  };
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

export function parseCSV(raw: string): { headers: string[]; rows: string[][] } {
  const lines = raw.trim().split("\n");
  const headers = parseCSVRow(lines[0]);
  return { headers, rows: lines.slice(1).map(parseCSVRow) };
}

export function parseCSVRow(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

export function rowToObj(headers: string[], row: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""]));
}

// ─── Leg detection ────────────────────────────────────────────────────────────

const SKIP_TIME_COLS = new Set(["Overall Finish Time", "Finish Time", "Wave Offset (Seconds)"]);

export function detectLegs(headers: string[]): string[] {
  return headers
    .filter((h) => h.endsWith(" Time") && !SKIP_TIME_COLS.has(h))
    .map((h) => h.replace(/ Time$/, ""));
}

// ─── Status helper ────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set<string>(Object.values(AthleteStatus));

export function toAthleteStatus(val: string | undefined): AthleteStatus {
  const upper = (val ?? "").trim().toUpperCase();
  if (VALID_STATUSES.has(upper)) return upper as AthleteStatus;
  return AthleteStatus.FIN;
}

// ─── Value helpers ────────────────────────────────────────────────────────────

export function toInt(val: string | undefined): number | null {
  if (!val) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

export function toFloat(val: string | undefined): number | null {
  if (!val) return null;
  if (val.includes(":")) return timeToSeconds(val);
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

export function timeToSeconds(t: string): number | null {
  const parts = t.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { csvFile, slug, raceName, year, eventType, eventDate } = parseArgs(process.argv);

  console.log(`\nIngesting: ${csvFile}`);
  console.log(`  Race:  ${raceName} (${slug})`);
  console.log(`  Year:  ${year}`);
  console.log(`  Type:  ${eventType}`);
  console.log(`  Date:  ${eventDate.toISOString().slice(0, 10)}\n`);

  const raw = await fs.readFile(csvFile, "utf8");
  const { headers, rows } = parseCSV(raw);
  const legs = detectLegs(headers);

  console.log(`Detected legs: ${legs.join(", ")}`);
  console.log(`Athlete rows:  ${rows.length}\n`);

  // ── Upsert Race ────────────────────────────────────────────────────────────
  const race = await prisma.race.upsert({
    where: { slug },
    update: { name: raceName },
    create: { slug, name: raceName },
  });
  console.log(`Race: ${race.name} (id=${race.id})`);

  // ── Upsert Event ──────────────────────────────────────────────────────────
  const event = await prisma.event.upsert({
    where: { raceId_year: { raceId: race.id, year } },
    update: { type: eventType, date: eventDate },
    create: { raceId: race.id, year, type: eventType, date: eventDate },
  });
  console.log(`Event: id=${event.id}`);

  // ── Upsert Segments ───────────────────────────────────────────────────────
  const segmentMap: Record<string, number> = {};
  for (let i = 0; i < legs.length; i++) {
    const name = legs[i];
    let segment = await prisma.segment.findFirst({
      where: { eventId: event.id, name },
    });
    if (segment) {
      segment = await prisma.segment.update({
        where: { id: segment.id },
        data: { displayOrder: i },
      });
    } else {
      segment = await prisma.segment.create({
        data: { eventId: event.id, name, displayOrder: i },
      });
    }
    segmentMap[name] = segment.id;
  }
  console.log(`Segments: ${Object.keys(segmentMap).join(", ")}`);

  // ── Upsert Athletes + AthleteSegments ─────────────────────────────────────
  // Process athletes in parallel using a worker pool to avoid the ~1M sequential
  // DB round trips that make large events (Chicago: 55k × 19 segments) very slow.
  // Each worker pulls from a shared queue, upserts the athlete, then upserts all
  // of its segments in a single Prisma transaction — reducing latency overhead.
  const CONCURRENCY = 20;
  const queue = rows.filter((r) => rowToObj(headers, r)["Bib"]);
  const total = queue.length;
  let completed = 0;
  const ingestStart = Date.now();

  async function ingestWorker() {
    while (queue.length > 0) {
      const row = queue.shift();
      if (!row) break;
      const obj = rowToObj(headers, row);

      const athleteData = {
        name: obj["Name"] ?? "",
        gender: obj["Gender"] ?? "",
        division: obj["Division"] ?? "",
        country: obj["Country"] ?? "",
        status: toAthleteStatus(obj["Status"]),
        finishTime: obj["Overall Finish Time"] || obj["Finish Time"] || null,
        overallRank: toInt(obj["Overall Rank"]),
        genderRank: toInt(obj["Gender Rank"]),
        divisionRank: toInt(obj["Division Rank"]),
      };

      // Upsert athlete + all its segments in one transaction to cut round trips
      await prisma.$transaction(async (tx) => {
        const athlete = await tx.athlete.upsert({
          where: { eventId_bib: { eventId: event.id, bib: obj["Bib"] } },
          update: athleteData,
          create: { eventId: event.id, bib: obj["Bib"], ...athleteData },
        });

        for (const leg of legs) {
          const segmentId = segmentMap[leg];
          const segData = {
            timeSeconds: toFloat(obj[`${leg} Time`]),
            gained: toInt(obj[`${leg} Gained`]),
            lost: toInt(obj[`${leg} Lost`]),
            net: toInt(obj[`${leg} Net`]),
          };
          await tx.athleteSegment.upsert({
            where: { athleteId_segmentId: { athleteId: athlete.id, segmentId } },
            update: segData,
            create: { athleteId: athlete.id, segmentId, ...segData },
          });
        }
      });

      completed++;
      if (completed % 500 === 0 || completed === total) {
        const elapsed = ((Date.now() - ingestStart) / 1000).toFixed(0);
        const pct = Math.round((completed / total) * 100);
        const rate = (completed / ((Date.now() - ingestStart) / 1000)).toFixed(0);
        process.stdout.write(
          `  ${completed}/${total} (${pct}%)  ${rate} athletes/s  ${elapsed}s elapsed\r`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, ingestWorker));

  console.log(
    `\nDone. ${completed} athletes ingested in ${((Date.now() - ingestStart) / 1000).toFixed(1)}s.\n`
  );
  await prisma.$disconnect();
}

// Only run when executed directly (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
}
