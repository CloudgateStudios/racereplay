#!/usr/bin/env node
/**
 * fetch-rtrt-starts.mjs
 *
 * Fetches per-athlete start timestamps from the RTRT.me live tracking API
 * (the data source behind the IRONMAN Tracker mobile app).
 *
 * In time-trial (TT) start races every athlete crosses the start mat
 * individually. RTRT records the precise Unix epoch timestamp of that
 * crossing. Combined with chip split times from the competitor.com results
 * CSV, this gives us the exact clock time each athlete was at every course
 * checkpoint — enabling true physical passing analysis.
 *
 * Usage:
 *   node scripts/fetch-rtrt-starts.mjs <rtrt-event-id> [output-dir]
 *
 * How to find the RTRT event ID:
 *   Format: IRM-<RACENAME>-<YEAR>  e.g. IRM-OCEANSIDE703-2025
 *   1. Go to https://track.rtrt.me — search for the race
 *   2. The URL will be https://track.rtrt.me/e/IRM-OCEANSIDE703-2025
 *   3. The path segment after /e/ is the event ID
 *   OR
 *   1. In scripts/data/<race>_<year>.csv, find the wtc_externaleventname field
 *      (visible with --dump-fields on the fetch-race.mjs event group page)
 *
 * Output:
 *   scripts/data/<event-id>_starts.csv
 *   Columns: Bib, Name, Division, Sex, StartEpoch, StartTimeOfDay
 *
 * Example:
 *   node scripts/fetch-rtrt-starts.mjs IRM-OCEANSIDE703-2025
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APPID  = "5824c5c948fd08c23a8b4567"; // IRONMAN Tracker app ID
const API    = "https://api.rtrt.me";
const UA     = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const PAGE   = 20;   // RTRT API max page size
const DELAY  = 100;  // ms between requests — be polite

async function rtrtFetch(path) {
  const res = await fetch(`${API}${path}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`RTRT API ${path} → HTTP ${res.status}`);
  return res.json();
}

async function register() {
  console.log("🔑 Registering with RTRT.me...");
  const data = await rtrtFetch(`/register?appid=${APPID}`);
  if (!data.token) throw new Error(`Registration failed: ${JSON.stringify(data)}`);
  console.log(`   Token: ${data.token}`);
  return data.token;
}

async function fetchAllStartSplits(eventId, token) {
  const qs = `appid=${APPID}&token=${token}`;

  // Verify the event exists and is accessible
  const event = await rtrtFetch(`/events/${eventId}?${qs}`);
  if (event.error) throw new Error(`Event not found: ${event.error.msg}`);
  console.log(`\n📍 Event: ${event.desc} (${event.date})`);
  console.log(`   Finishers reported: ${event.finishers ?? "unknown"}`);

  const splits = [];
  let start = 1;
  let totalPages = "?";

  while (true) {
    const url = `/events/${eventId}/points/START/splits?${qs}&start=${start}`;
    const data = await rtrtFetch(url);

    if (data.error) throw new Error(`Splits fetch failed: ${data.error.msg}`);
    if (!data.list?.length) break;

    splits.push(...data.list);

    const last = parseInt(data.info?.last ?? start);
    const fetched = data.list.length;
    process.stdout.write(`\r   Fetched ${splits.length} start records...`);

    if (fetched < PAGE) break; // last page
    start = last + 1;

    await new Promise((r) => setTimeout(r, DELAY));
  }

  console.log(`\n   Total: ${splits.length} start records`);
  return splits;
}

function buildCSV(splits) {
  const headers = ["Bib", "Name", "Division", "Sex", "StartEpoch", "StartTimeOfDay"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const rows = splits.map((s) => [
    s.bib,
    s.name,
    s.division || "",
    s.sex || "",
    s.epochTime,          // precise Unix timestamp (seconds + decimals)
    s.startTime || "",    // local time of day string e.g. "7:20:34 am"
  ].map(esc).join(","));

  return [headers.join(","), ...rows].join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const [, , eventId, outputDir = path.join(__dirname, "data")] = process.argv;

if (!eventId) {
  console.error(`
Usage: node scripts/fetch-rtrt-starts.mjs <rtrt-event-id> [output-dir]

  rtrt-event-id   e.g. IRM-OCEANSIDE703-2025
  output-dir      Where to write output CSV. Defaults to scripts/data/

How to find the RTRT event ID:
  - Go to https://track.rtrt.me and search for the race
  - The URL path segment after /e/ is the event ID
  - Format: IRM-<RACENAME><DISTANCE>-<YEAR>
    e.g. IRM-OCEANSIDE703-2025, IRM-KONA-2025, IRM-FLORIDA-2024
`);
  process.exit(1);
}

(async () => {
  try {
    await fs.mkdir(outputDir, { recursive: true });

    const token = await register();
    const splits = await fetchAllStartSplits(eventId, token);

    if (!splits.length) {
      console.warn("\n⚠️  No start splits returned. Race may not have data yet.");
      process.exit(0);
    }

    const csv = buildCSV(splits);
    const filename = path.join(outputDir, `${eventId.toLowerCase()}_starts.csv`);
    await fs.writeFile(filename, csv);

    console.log(`\n✅ Start times written to: ${filename}`);
    console.log(`\nNext step:`);
    console.log(`  node scripts/analyze-passing.mjs <results.csv> --rtrt-starts ${filename}\n`);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    process.exit(1);
  }
})();
