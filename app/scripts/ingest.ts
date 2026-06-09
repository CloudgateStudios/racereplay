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
 * Race metadata (location, country, distanceType, seriesName, website) is
 * loaded automatically from scripts/races.config.json if an entry exists for
 * the slug. CLI flags override the config file value for that field.
 *
 * Examples:
 *   npx tsx scripts/ingest.ts ../scripts/data/IRM-CHATTANOOGA703-2026_passing.csv \
 *     --slug im-703-chattanooga \
 *     --race-name "IM 70.3 Chattanooga" \
 *     --year 2026 \
 *     --event-type triathlon \
 *     --event-date 2026-05-18
 *
 *   # Override a single field from the config:
 *   npx tsx scripts/ingest.ts ../scripts/data/IRM-CHATTANOOGA703-2026_passing.csv \
 *     --slug im-703-chattanooga \
 *     --race-name "IM 70.3 Chattanooga" \
 *     --year 2026 \
 *     --event-type triathlon \
 *     --event-date 2026-05-18 \
 *     --website https://www.ironman.com/im703-chattanooga-2026
 *
 * Safe to re-run — all writes are upserts keyed on (slug, year, bib).
 *
 * Add --dry-run to print detected columns and legs without writing anything:
 *   npx tsx scripts/ingest.ts <passing-csv> --dry-run
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

import fs from "fs/promises";
import { readFileSync } from "fs";
import { PrismaClient, AthleteStatus } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Produces a stable, case-insensitive key from an athlete name.
 * Used to match the same person across years / races.
 *
 * Steps:
 *   1. Lowercase
 *   2. Decompose accented chars (NFD) and strip combining marks — é→e, ñ→n
 *   3. Remove all punctuation and non-alphanumeric characters
 *   4. Collapse multiple spaces, trim
 *
 * Examples:
 *   "Alfredo Ramírez Pinho" → "alfredo ramirez pinho"
 *   "O'Brien, Sean"         → "obrien sean"
 *   "Tom  Arra"             → "tom arra"
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .replace(/[^a-z0-9\s]/g, "") // remove punctuation
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── Arg parsing ─────────────────────────────────────────────────────────────

interface RaceMetadata {
  location?: string;
  country?: string;
  distanceType?: string;
  seriesName?: string;
  website?: string;
}

interface Args {
  csvFile: string;
  slug: string;
  raceName: string;
  year: number;
  eventType: "TRIATHLON" | "ROAD_RACE";
  eventDate: Date;
  dryRun: boolean;
  metadata: RaceMetadata;
}

function loadRacesConfig(): Record<string, RaceMetadata> {
  try {
    const configPath = path.resolve(__dirname, "races.config.json");
    const raw = readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const flags: Record<string, string> = {};
  let csvFile: string | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    } else if (!csvFile) {
      csvFile = args[i];
    }
  }

  // --dry-run only needs the CSV file
  if (!dryRun) {
    const required = ["slug", "race-name", "year", "event-type", "event-date"];
    for (const key of required) {
      if (!flags[key]) {
        console.error(`Missing required flag: --${key}`);
        process.exit(1);
      }
    }
  }
  if (!csvFile) {
    console.error("Missing required argument: <passing-csv>");
    process.exit(1);
  }

  const rawType = (flags["event-type"] ?? "TRIATHLON").toUpperCase().replace("-", "_");
  if (!dryRun && rawType !== "TRIATHLON" && rawType !== "ROAD_RACE") {
    console.error(`--event-type must be triathlon or road_race`);
    process.exit(1);
  }

  const slug = flags["slug"] ?? "";

  // Merge config file → CLI args (CLI takes precedence)
  const configMetadata = loadRacesConfig()[slug] ?? {};
  const metadata: RaceMetadata = {
    location: flags["location"] ?? configMetadata.location,
    country: flags["country"] ?? configMetadata.country,
    distanceType: flags["distance-type"] ?? configMetadata.distanceType,
    seriesName: flags["series-name"] ?? configMetadata.seriesName,
    website: flags["website"] ?? configMetadata.website,
  };

  return {
    csvFile: path.resolve(csvFile),
    slug,
    raceName: flags["race-name"] ?? "",
    year: parseInt(flags["year"] ?? "0", 10),
    eventType: rawType as "TRIATHLON" | "ROAD_RACE",
    eventDate: new Date(flags["event-date"] ?? ""),
    dryRun,
    metadata,
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

const SKIP_TIME_COLS = new Set([
  "Overall Finish Time",
  "Wave Finish Time",
  "Wave Offset (Seconds)",
]);

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

// ─── Gender helper ────────────────────────────────────────────────────────────

import { Gender } from "../src/generated/prisma/client";

export function toGender(val: string | undefined): Gender {
  switch ((val ?? "").trim().toLowerCase()) {
    case "male":
    case "m":
      return Gender.Male;
    case "female":
    case "f":
      return Gender.Female;
    case "open":
    case "o":
      return Gender.Open;
    default:
      return Gender.Unknown;
  }
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

// ─── Column validation ────────────────────────────────────────────────────────

const EXPECTED_COLS = [
  "Bib",
  "Name",
  "Gender",
  "Division",
  "Country",
  "City",
  "Team",
  "Status",
  "Wave Finish Time",
];
const EXPECTED_FINISH_COLS = ["Overall Finish Time"];
const EXPECTED_RANK_COLS = ["Overall Rank", "Gender Rank", "Division Rank"];

export function warnMissingColumns(headers: string[]): void {
  const headerSet = new Set(headers);
  for (const col of EXPECTED_COLS) {
    if (!headerSet.has(col)) {
      console.warn(`  ⚠ Expected column not found: "${col}" — data will be empty for this field`);
    }
  }
  if (!EXPECTED_FINISH_COLS.some((c) => headerSet.has(c))) {
    console.warn(
      `  ⚠ Neither "Overall Finish Time" nor "Finish Time" found — finish times will be empty`
    );
  }
  for (const col of EXPECTED_RANK_COLS) {
    if (!headerSet.has(col)) {
      console.warn(`  ⚠ Expected column not found: "${col}" — rank will be null`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { csvFile, slug, raceName, year, eventType, eventDate, dryRun, metadata } = parseArgs(
    process.argv
  );

  console.log(`\nIngesting: ${csvFile}`);
  if (!dryRun) {
    console.log(`  Race:  ${raceName} (${slug})`);
    console.log(`  Year:  ${year}`);
    console.log(`  Type:  ${eventType}`);
    console.log(`  Date:  ${eventDate.toISOString().slice(0, 10)}`);
    if (metadata.location) console.log(`  Location:     ${metadata.location}`);
    if (metadata.country) console.log(`  Country:      ${metadata.country}`);
    if (metadata.distanceType) console.log(`  Distance:     ${metadata.distanceType}`);
    if (metadata.seriesName) console.log(`  Series:       ${metadata.seriesName}`);
    if (metadata.website) console.log(`  Website:      ${metadata.website}`);
  }
  console.log();

  const raw = await fs.readFile(csvFile, "utf8");
  const { headers, rows } = parseCSV(raw);
  const legs = detectLegs(headers);

  console.log(`Detected legs:   ${legs.length > 0 ? legs.join(", ") : "(none)"}`);
  console.log(`Athlete rows:    ${rows.length}`);
  console.log(`All CSV columns: ${headers.join(", ")}\n`);

  console.log("Column check:");
  warnMissingColumns(headers);
  console.log();

  if (dryRun) {
    console.log("Dry run complete — no data written.");
    return;
  }

  // ── Upsert Race ────────────────────────────────────────────────────────────
  // Metadata fields (location, country, etc.) are only updated when a value is
  // provided — undefined fields are omitted so existing DB values are preserved.
  const metadataUpdate = Object.fromEntries(
    Object.entries(metadata).filter(([, v]) => v !== undefined)
  );
  const race = await prisma.race.upsert({
    where: { slug },
    update: { name: raceName, ...metadataUpdate },
    create: { slug, name: raceName, ...metadataUpdate },
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
    const isFinish = name.toLowerCase() === "finish";
    if (segment) {
      segment = await prisma.segment.update({
        where: { id: segment.id },
        data: { displayOrder: i, isFinish },
      });
    } else {
      segment = await prisma.segment.create({
        data: { eventId: event.id, name, displayOrder: i, isFinish },
      });
    }
    segmentMap[name] = segment.id;
  }
  console.log(`Segments: ${Object.keys(segmentMap).join(", ")}`);

  // ── Remove stale segments ─────────────────────────────────────────────────
  // If a segment's name changed between scraper runs (e.g. "Bike Finish" →
  // "Bike"), the old segment would otherwise persist as an orphan.  Delete
  // any segment for this event whose name is NOT in the current legs list,
  // cascading through AthleteSegment first (no FK cascade on the schema).
  const staleSegments = await prisma.segment.findMany({
    where: { eventId: event.id, name: { notIn: legs } },
    select: { id: true, name: true },
  });
  if (staleSegments.length > 0) {
    const staleIds = staleSegments.map((s) => s.id);
    const staleNames = staleSegments.map((s) => s.name).join(", ");
    console.log(`Removing stale segment(s): ${staleNames}`);
    await prisma.athleteSegment.deleteMany({ where: { segmentId: { in: staleIds } } });
    await prisma.segment.deleteMany({ where: { id: { in: staleIds } } });
  }

  // ── Upsert Athletes + AthleteSegments ─────────────────────────────────────
  // Process athletes in parallel using a worker pool to avoid the ~1M sequential
  // DB round trips that make large events (Chicago: 55k × 19 segments) very slow.
  // Each worker pulls from a shared queue, upserts the athlete, then upserts all
  // of its segments in a single Prisma transaction — reducing latency overhead.
  const CONCURRENCY = 20;
  const queue = rows.filter((r) => rowToObj(headers, r)["Bib"]);
  const total = queue.length;
  let completed = 0;
  let created = 0;
  let updated = 0;
  const ingestStart = Date.now();

  // Pre-fetch existing bibs for this event so we can report created vs updated
  const existingBibs = new Set(
    (await prisma.athlete.findMany({ where: { eventId: event.id }, select: { bib: true } })).map(
      (a) => a.bib
    )
  );

  // Collect category totals keyed by "category|name" → total.
  // Multiple athletes share the same category total (e.g. all males have
  // the same "gender total"). We accumulate unique entries here and upsert
  // them after the athlete loop.
  const categoryTotalMap = new Map<string, { category: string; name: string; total: number }>();

  async function ingestWorker() {
    while (queue.length > 0) {
      const row = queue.shift();
      if (!row) break;
      const obj = rowToObj(headers, row);

      const athleteName = (obj["Name"] ?? "").trim();

      // Sum timeSeconds for all non-finish legs to get a numeric finish time.
      // The "Finish" leg is a virtual segment added by the pipeline and is not
      // part of the race clock — exclude it from the sum.
      const finishLegs = legs.filter((l) => l.toLowerCase() !== "finish");
      const legTimes = finishLegs.map((l) => toFloat(obj[`${l} Time`]));
      const finishSeconds = legTimes.every((t) => t !== null)
        ? Math.round(legTimes.reduce((sum, t) => sum! + t!, 0)!)
        : null;

      const athleteData = {
        name: athleteName,
        normalizedName: normalizeName(athleteName),
        gender: toGender(obj["Gender"]),
        division: (obj["Division"] ?? "").trim(),
        country: (obj["Country"] ?? "").trim(),
        city: (obj["City"] ?? "").trim() || null,
        team: (obj["Team"] ?? "").trim() || null,
        status: toAthleteStatus(obj["Status"]),
        finishTime: (obj["Overall Finish Time"] || obj["Finish Time"] || "").trim() || null,
        finishSeconds,
        waveTime: (obj["Wave Finish Time"] ?? "").trim() || null,
        overallRank: toInt(obj["Overall Rank"]),
        genderRank: toInt(obj["Gender Rank"]),
        divisionRank: toInt(obj["Division Rank"]),
      };

      // Accumulate category totals — use the athlete's own gender/division as the name
      const overallTotal = toInt(obj["Overall Category Total"]);
      const genderTotal = toInt(obj["Gender Category Total"]);
      const divisionTotal = toInt(obj["Division Category Total"]);
      if (overallTotal != null) {
        categoryTotalMap.set("overall|Overall", {
          category: "overall",
          name: "Overall",
          total: overallTotal,
        });
      }
      if (genderTotal != null && athleteData.gender) {
        const key = `gender|${athleteData.gender}`;
        if (!categoryTotalMap.has(key)) {
          categoryTotalMap.set(key, {
            category: "gender",
            name: athleteData.gender,
            total: genderTotal,
          });
        }
      }
      if (divisionTotal != null && athleteData.division) {
        const key = `division|${athleteData.division}`;
        if (!categoryTotalMap.has(key)) {
          categoryTotalMap.set(key, {
            category: "division",
            name: athleteData.division,
            total: divisionTotal,
          });
        }
      }

      // Upsert athlete + all its segments in one transaction to cut round trips
      const isNew = !existingBibs.has(obj["Bib"]);
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
            epochTime: toFloat(obj[`${leg} EpochTime`]),
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

      if (isNew) created++;
      else updated++;
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
    `\nDone. ${completed} athletes in ${((Date.now() - ingestStart) / 1000).toFixed(1)}s — ${created} created, ${updated} updated.\n`
  );

  // ── Upsert CategoryResults ─────────────────────────────────────────────────
  if (categoryTotalMap.size > 0) {
    console.log(`Upserting ${categoryTotalMap.size} category result(s)...`);
    for (const { category, name, total } of categoryTotalMap.values()) {
      await prisma.categoryResult.upsert({
        where: { eventId_category_name: { eventId: event.id, category, name } },
        update: { total },
        create: { eventId: event.id, category, name, total },
      });
    }
    console.log("Category results done.\n");
  }

  // ── Update Event counts ───────────────────────────────────────────────────
  // Derive finisherCount and totalCount from the ingested athlete rows so the
  // event card can show "X finishers" without a COUNT query on every render.
  const [finisherCount, totalCount] = await Promise.all([
    prisma.athlete.count({ where: { eventId: event.id, status: "FIN" } }),
    prisma.athlete.count({ where: { eventId: event.id } }),
  ]);
  await prisma.event.update({
    where: { id: event.id },
    data: { finisherCount, totalCount },
  });
  console.log(`Event counts: ${finisherCount} finishers / ${totalCount} total.\n`);

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
