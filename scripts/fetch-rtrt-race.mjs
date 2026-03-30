#!/usr/bin/env node
/**
 * fetch-rtrt-race.mjs
 *
 * Builds a complete race results CSV using RTRT.me as the sole data source.
 * Useful when competitor.com has not yet published results (e.g. the day
 * after a race) or as a cross-check against competitor.com data.
 *
 * RTRT records a precise Unix epoch timestamp at every timing mat. By
 * fetching splits at the six key aggregate points (START, SWIM, T1, BIKE,
 * T2, FINISH) and joining them by athlete, we get everything the passing
 * algorithm needs:
 *
 *   epochTime[point] = startEpoch + netTime[point]
 *
 * The output CSV uses the same column names as fetch-race.mjs so that
 * analyze-passing.mjs can read either file without modification.
 *
 * Usage:
 *   node scripts/fetch-rtrt-race.mjs <rtrt-event-id> [output-dir]
 *
 * Example:
 *   node scripts/fetch-rtrt-race.mjs IRM-OCEANSIDE703-2026
 *
 * Then run the analysis:
 *   node scripts/analyze-passing.mjs scripts/data/IRM-OCEANSIDE703-2026.csv \
 *     --rtrt-starts scripts/data/irm-oceanside703-2026_starts.csv
 *
 * Note: the _starts.csv is ALSO built from RTRT, so for a fresh race you
 * only need this one command to get both files:
 *   node scripts/fetch-rtrt-race.mjs IRM-OCEANSIDE703-2026
 * (start times are embedded in the output and also written as a _starts.csv)
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APPID = "5824c5c948fd08c23a8b4567";
const API   = "https://api.rtrt.me";
const UA    = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const PAGE        = 20;
const DELAY       = 300;  // ms between pages within a point (≈3 req/sec — stay under rate limit)
const POINT_DELAY = 5000; // ms between fetching different timing points (let API breathe)

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function rtrtFetch(path) {
  const res = await fetch(`${API}${path}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`RTRT ${path} → HTTP ${res.status}`);
  return res.json();
}

async function register() {
  const data = await rtrtFetch(`/register?appid=${APPID}`);
  if (!data.token) throw new Error(`Registration failed: ${JSON.stringify(data)}`);
  return data.token;
}

/** Parse "H:MM:SS.sss" or "MM:SS.sss" → total seconds (float) */
function parseTime(t) {
  if (!t) return null;
  const parts = t.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

/** Format seconds → "H:MM:SS" */
function fmtTime(secs) {
  if (secs == null || secs <= 0) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Fetch all splits at a given timing point, paginated.
 * tokenRef is an object { value: string } so we can refresh mid-fetch.
 * Returns Map<bib, splitRecord>.
 */
async function fetchAllSplitsAtPoint(eventId, point, tokenRef) {
  const map = new Map();
  let start = 1;
  let retries = 0;

  while (true) {
    const qs = `appid=${APPID}&token=${tokenRef.value}`;
    const url = `/events/${eventId}/points/${point}/splits?${qs}&start=${start}`;
    const data = await rtrtFetch(url);

    if (data.error) {
      const msg = data.error.msg ?? "";
      const type = data.error.type ?? "";
      // "no_results" means either:
      //   (a) this point has no data at all (start=1), or
      //   (b) we paginated past the last record (start > total).
      // In both cases, return whatever we've collected so far.
      if (type === "no_results" || type === "access_denied" || msg.toLowerCase().includes("not found")) {
        return map;
      }
      // For other transient errors, back off and retry
      if (retries < 3) {
        retries++;
        const wait = retries * 5000;
        process.stdout.write(` [retry #${retries} in ${wait / 1000}s]`);
        await new Promise((r) => setTimeout(r, wait));
        tokenRef.value = await register();
        continue;
      }
      throw new Error(`Splits fetch at ${point} failed: ${msg}`);
    }

    retries = 0; // reset on success
    if (!data.list?.length) break;

    for (const s of data.list) {
      // Keep first record per bib (earliest/fastest in case of duplicates)
      if (!map.has(String(s.bib))) map.set(String(s.bib), s);
    }

    if (data.list.length < PAGE) break;
    start = parseInt(data.info?.last ?? start) + 1;
    await new Promise((r) => setTimeout(r, DELAY));
  }

  return map;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const [, , eventId, outputDir = path.join(__dirname, "data")] = process.argv;

if (!eventId) {
  console.error(`
Usage: node scripts/fetch-rtrt-race.mjs <rtrt-event-id> [output-dir]

  rtrt-event-id   e.g. IRM-OCEANSIDE703-2026
  output-dir      Defaults to scripts/data/

Builds a complete race CSV from RTRT.me without needing competitor.com.
Useful immediately after a race before competitor.com publishes results.
Also writes a _starts.csv so you can run analyze-passing.mjs directly.
`);
  process.exit(1);
}

(async () => {
  try {
    await fs.mkdir(outputDir, { recursive: true });

    console.log("🔑 Registering with RTRT.me...");
    const tokenRef = { value: await register() };

    // Verify event
    const event = await rtrtFetch(`/events/${eventId}?appid=${APPID}&token=${tokenRef.value}`);
    if (event.error) throw new Error(`Event not found: ${event.error.msg}`);
    console.log(`\n📍 Event: ${event.desc} (${event.date})`);
    console.log(`   Finishers reported: ${event.finishers ?? "unknown"}`);

    // Fetch splits at each key aggregate point
    const POINTS = ["START", "SWIM", "T1", "BIKE", "T2", "FINISH"];
    const splits = {};

    for (let i = 0; i < POINTS.length; i++) {
      const point = POINTS[i];
      if (i > 0) await new Promise((r) => setTimeout(r, POINT_DELAY));
      process.stdout.write(`\n   Fetching ${point} splits...`);
      splits[point] = await fetchAllSplitsAtPoint(eventId, point, tokenRef);
      console.log(` ${splits[point].size} records`);
    }

    // Union of all athlete bibs
    const allBibs = new Set([
      ...splits.START.keys(),
      ...splits.SWIM.keys(),
      ...splits.FINISH.keys(),
    ]);
    console.log(`\n   Total athletes found: ${allBibs.size}`);

    // Build result rows
    const rows = [];

    for (const bib of allBibs) {
      const start  = splits.START.get(bib);
      const swim   = splits.SWIM.get(bib);
      const t1     = splits.T1.get(bib);
      const bike   = splits.BIKE.get(bib);
      const t2     = splits.T2.get(bib);
      const finish = splits.FINISH.get(bib);

      // Use whichever record has the fullest profile data
      const profile = finish ?? swim ?? start;
      if (!profile) continue;

      const hasDNF = !finish;
      const status = hasDNF ? "DNF" : "FIN";

      // Chip times in seconds (netTime = cumulative chip elapsed from personal start)
      const swimSecs   = parseTime(swim?.netTime);
      const t1cumSecs  = parseTime(t1?.netTime);
      const bikeCumSecs = parseTime(bike?.netTime);
      const t2CumSecs  = parseTime(t2?.netTime);
      const finishSecs = parseTime(finish?.netTime);

      const t1Secs   = (t1cumSecs != null && swimSecs != null)
        ? Math.round(t1cumSecs - swimSecs) : null;
      const bikeSecs  = (bikeCumSecs != null && t1cumSecs != null)
        ? Math.round(bikeCumSecs - t1cumSecs) : null;
      const t2Secs   = (t2CumSecs != null && bikeCumSecs != null)
        ? Math.round(t2CumSecs - bikeCumSecs) : null;
      const runSecs  = (finishSecs != null && t2CumSecs != null)
        ? Math.round(finishSecs - t2CumSecs) : null;

      // Rankings from the FINISH split results object
      const results = finish?.results ?? {};
      const overallRank  = results["course"]?.p ?? "";
      const genderRank   = results["course-sex"]?.p ?? "";
      const divisionRank = results["course-sex-division"]?.p ?? "";

      // Gender: RTRT uses "M"/"F", normalize to "Male"/"Female"
      const gender = profile.sex === "M" ? "Male" : profile.sex === "F" ? "Female" : "";

      rows.push({
        bib,
        name:         profile.name ?? "",
        gender,
        city:         profile.city ?? "",
        state:        "",
        country:      profile.country_iso?.toUpperCase() ?? "",
        division:     profile.division ?? "",
        status,
        finishTime:   fmtTime(finishSecs),
        swimTime:     fmtTime(swimSecs),
        t1Time:       fmtTime(t1Secs),
        bikeTime:     fmtTime(bikeSecs),
        t2Time:       fmtTime(t2Secs),
        runTime:      fmtTime(runSecs),
        overallRank,
        genderRank,
        divisionRank,
        finishSecs:   finishSecs ?? "",
        swimSecs:     swimSecs ?? "",
        t1Secs:       t1Secs ?? "",
        bikeSecs:     bikeSecs ?? "",
        t2Secs:       t2Secs ?? "",
        runSecs:      runSecs ?? "",
        startEpoch:   start?.epochTime ?? "",
        startTimeOfDay: start?.startTime ?? "",
      });
    }

    // Sort by overall rank (finishers first, then DNFs)
    rows.sort((a, b) => {
      const ra = parseInt(a.overallRank) || 99999;
      const rb = parseInt(b.overallRank) || 99999;
      return ra - rb;
    });

    const finishers = rows.filter((r) => r.status === "FIN").length;
    const dnfs = rows.filter((r) => r.status === "DNF").length;
    console.log(`   Finishers: ${finishers} | DNFs: ${dnfs}`);

    // ── Write results CSV (compatible with analyze-passing.mjs) ──────────────
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const headers = [
      "Bib Number", "Athlete Name", "Gender", "City", "State", "Country",
      "Division", "Status", "Finish Time", "Swim Time", "T1 Time", "Bike Time",
      "T2 Time", "Run Time", "Overall Rank", "Gender Rank", "Division Rank",
      "Finish (Seconds)", "Swim (Seconds)", "T1 (Seconds)", "Bike (Seconds)",
      "T2 (Seconds)", "Run (Seconds)",
    ];
    const csvRows = rows.map((r) => [
      r.bib, r.name, r.gender, r.city, r.state, r.country,
      r.division, r.status, r.finishTime, r.swimTime, r.t1Time, r.bikeTime,
      r.t2Time, r.runTime, r.overallRank, r.genderRank, r.divisionRank,
      r.finishSecs, r.swimSecs, r.t1Secs, r.bikeSecs, r.t2Secs, r.runSecs,
    ].map(esc).join(","));
    const resultsCsv = [headers.join(","), ...csvRows].join("\n");

    const resultsFile = path.join(outputDir, `${eventId}.csv`);
    await fs.writeFile(resultsFile, resultsCsv);
    console.log(`\n✅ Results written to: ${resultsFile}`);

    // ── Write starts CSV (compatible with --rtrt-starts flag) ────────────────
    const startHeaders = ["Bib", "Name", "Division", "Sex", "StartEpoch", "StartTimeOfDay"];
    const startRows = rows
      .filter((r) => r.startEpoch)
      .map((r) => [r.bib, r.name, r.division, r.gender === "Male" ? "M" : "F",
                   r.startEpoch, r.startTimeOfDay].map(esc).join(","));
    const startsCsv = [startHeaders.join(","), ...startRows].join("\n");

    const startsFile = path.join(outputDir, `${eventId.toLowerCase()}_starts.csv`);
    await fs.writeFile(startsFile, startsCsv);
    console.log(`✅ Start times written to: ${startsFile}`);

    console.log(`
Next step:
  node scripts/analyze-passing.mjs ${resultsFile} \\
    --rtrt-starts ${startsFile}
`);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
})();
