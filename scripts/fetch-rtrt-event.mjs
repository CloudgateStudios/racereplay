#!/usr/bin/env node
/**
 * fetch-rtrt-event.mjs
 *
 * Generic RTRT.me race fetcher — works with any event that uses RTRT for
 * live tracking, not just IRONMAN. Automatically discovers timing points,
 * builds a results CSV with leg columns named after the actual timing segments,
 * and writes a _starts.csv for use with analyze-passing.mjs.
 *
 * Unlike fetch-rtrt-race.mjs (which is hard-coded for triathlon's six points),
 * this script discovers and fetches all "significant" timing points for the event.
 *
 * What counts as a significant point:
 *   - The START mat (isStart = "1")
 *   - The FINISH mat (isFinish = "1")
 *   - Any intermediate point where publish = "1" AND hide_in_badges = "0"
 *     (this excludes km-marker checkpoints while keeping meaningful splits like
 *      the 5K mat in a road race or T1/T2/BIKE in a triathlon)
 *
 * Leg naming: each leg is named after the timing point that ends it.
 *   START → 5K   = leg "5K"
 *   5K → FINISH  = leg "Run"   (from label "Run/Finish" → take first part)
 *
 * Output CSV columns are compatible with analyze-passing.mjs:
 *   Bib Number, Athlete Name, Gender, Country, Division, Status,
 *   Finish Time, [Leg1] Time, [Leg2] Time, ...,
 *   Overall Rank, Gender Rank, Division Rank,
 *   Finish (Seconds), [Leg1] (Seconds), [Leg2] (Seconds), ...
 *
 * Usage:
 *   node scripts/fetch-rtrt-event.mjs <event-id> [options]
 *
 * Options:
 *   --appid <id>         RTRT app ID for this event's tracker app.
 *                        Defaults to the IRONMAN Tracker app ID.
 *                        Find it at track.rtrt.me/e/<event-id> (view page source,
 *                        search for "appid").
 *   --output-dir <dir>   Directory to write output files (default: scripts/data/)
 *   --points <list>      Comma-separated list of point names to use, in order.
 *                        Overrides auto-discovery. Must include the finish point.
 *                        Example: --points START,5K,10K,FINISH
 *
 * Examples:
 *   # Shamrock Shuffle 2026 (Bank of America — uses a different app ID)
 *   node scripts/fetch-rtrt-event.mjs BASS2026 --appid 4d9df5bf9f36bc4a1dc8fce2
 *
 *   # Any IRONMAN event (uses default IRONMAN app ID)
 *   node scripts/fetch-rtrt-event.mjs IRM-OCEANSIDE703-2026
 *
 * Then run the analysis:
 *   node scripts/analyze-passing.mjs scripts/data/BASS2026.csv \
 *     --rtrt-starts scripts/data/bass2026_starts.csv
 *
 * Note on large races: fetching splits for a 24,000-athlete event takes ~18 minutes
 * (3 points × 1,200 pages × 300ms/page + pauses between points). This is a one-time
 * cost — results are written to disk and served from your own database thereafter.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// IRONMAN Tracker app ID — default for all IRM-* events
const IRONMAN_APPID = "5824c5c948fd08c23a8b4567";
const API   = "https://api.rtrt.me";
const UA    = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const PAGE  = 20;
const DELAY       = 300;  // ms between pages within a point
const POINT_DELAY = 5000; // ms between fetching different timing points

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function rtrtFetch(p) {
  const res = await fetch(`${API}${p}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`RTRT ${p} → HTTP ${res.status}`);
  return res.json();
}

async function register(appid) {
  const data = await rtrtFetch(`/register?appid=${appid}`);
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
 * Clean a timing point label into a CSV-friendly leg name.
 * "Run/Finish" → "Run"  (first part before "/")
 * "5K"         → "5K"
 * "10 Mile"    → "10 Mile"
 * "Bike 56mi | 89km" → "Bike 56mi"
 * "FINISH"     → ""  (caller supplies fallback — "FINISH" is a reserved column prefix)
 * "START"      → ""  (start is not a leg)
 */
function cleanLabel(label) {
  const clean = (label || "")
    .split("/")[0]   // take first part before "/"
    .split("|")[0]   // take first part before "|"
    .trim();
  // "FINISH" and "START" are reserved column prefixes — return empty so the
  // caller can provide a more descriptive positional fallback name.
  if (/^(finish|start)$/i.test(clean)) return "";
  return clean;
}

/**
 * Fetch all timing points for an event (paginated).
 * Returns the full list sorted by km distance.
 */
async function fetchAllPoints(eventId, appid, token) {
  const qs = `appid=${appid}&token=${token}`;
  const allPoints = [];
  let start = 1;

  while (true) {
    const data = await rtrtFetch(`/events/${eventId}/points?${qs}&start=${start}`);
    if (data.error || !data.list?.length) break;
    allPoints.push(...data.list);
    if (data.list.length < PAGE) break;
    start = parseInt(data.info?.last ?? start) + 1;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Sort by km distance so we have them in course order
  return allPoints.sort((a, b) => parseFloat(a.km || 0) - parseFloat(b.km || 0));
}

/**
 * Fetch all splits at a timing point (paginated).
 * tokenRef is { value: string } to allow mid-fetch token refresh.
 * Returns Map<bib, splitRecord>.
 */
async function fetchAllSplitsAtPoint(eventId, pointName, appid, tokenRef) {
  const map = new Map();
  let start = 1;
  let retries = 0;

  while (true) {
    const qs = `appid=${appid}&token=${tokenRef.value}`;
    const url = `/events/${eventId}/points/${pointName}/splits?${qs}&start=${start}`;
    const data = await rtrtFetch(url);

    if (data.error) {
      const type = data.error.type ?? "";
      const msg  = data.error.msg ?? "";
      // no_results = paginated past the end, or point genuinely empty — either way, done
      if (type === "no_results" || type === "access_denied" || msg.toLowerCase().includes("not found")) {
        return map;
      }
      // Transient error — back off and retry with a fresh token
      if (retries < 3) {
        retries++;
        const wait = retries * 5000;
        process.stdout.write(` [retry ${retries} in ${wait / 1000}s]`);
        await new Promise((r) => setTimeout(r, wait));
        tokenRef.value = await register(appid);
        continue;
      }
      throw new Error(`Splits fetch at ${pointName} failed: ${msg}`);
    }

    retries = 0;
    if (!data.list?.length) break;
    for (const s of data.list) {
      if (!map.has(String(s.bib))) map.set(String(s.bib), s);
    }
    if (data.list.length < PAGE) break;
    start = parseInt(data.info?.last ?? start) + 1;
    await new Promise((r) => setTimeout(r, DELAY));
  }

  return map;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const eventId   = args.find((a) => !a.startsWith("--"));
const appidIdx  = args.indexOf("--appid");
const appid     = appidIdx !== -1 ? args[appidIdx + 1] : IRONMAN_APPID;
const outdirIdx = args.indexOf("--output-dir");
const outputDir = outdirIdx !== -1 ? args[outdirIdx + 1] : path.join(__dirname, "data");
const pointsIdx = args.indexOf("--points");
const forcedPoints = pointsIdx !== -1 ? args[pointsIdx + 1]?.split(",").map((p) => p.trim()) : null;

if (!eventId) {
  console.error(`
Usage: node scripts/fetch-rtrt-event.mjs <event-id> [options]

  event-id             RTRT event ID, e.g. BASS2026 or IRM-OCEANSIDE703-2026

Options:
  --appid <id>         RTRT app ID for this event's tracker.
                       Default: IRONMAN Tracker (for IRM-* events).
                       For other events, find it at track.rtrt.me/e/<event-id>
                       (view page source, search for "appid").
  --output-dir <dir>   Directory to write output files (default: scripts/data/)
  --points <list>      Comma-separated timing point names to use, in order.
                       Overrides auto-discovery.
                       Example: --points START,5K,10K,FINISH

Examples:
  # Shamrock Shuffle 2026
  node scripts/fetch-rtrt-event.mjs BASS2026 --appid 4d9df5bf9f36bc4a1dc8fce2

  # Any IRONMAN event
  node scripts/fetch-rtrt-event.mjs IRM-OCEANSIDE703-2026

  # With explicit point list
  node scripts/fetch-rtrt-event.mjs BASS2026 --appid 4d9df5bf9f36bc4a1dc8fce2 \\
    --points START,5K,FINISH
`);
  process.exit(1);
}

(async () => {
  try {
    await fs.mkdir(outputDir, { recursive: true });

    console.log("🔑 Registering with RTRT.me...");
    const tokenRef = { value: await register(appid) };

    // Verify event exists
    const event = await rtrtFetch(`/events/${eventId}?appid=${appid}&token=${tokenRef.value}`);
    if (event.error) throw new Error(`Event not found: ${event.error.msg}`);
    console.log(`\n📍 Event: ${event.desc} (${event.date})`);
    console.log(`   Location: ${event.loc?.desc ?? "unknown"}`);
    console.log(`   Finishers reported: ${event.finishers ?? "unknown"}`);

    // ── Determine which timing points to fetch ────────────────────────────────
    let pointsToFetch; // array of { name, label, legName }

    if (forcedPoints) {
      // User explicitly specified points — trust them
      pointsToFetch = forcedPoints.map((name, i) => ({
        name,
        label: name,
        legName: name,
        isStart: i === 0,
        isFinish: i === forcedPoints.length - 1,
      }));
      console.log(`\n📋 Using specified points: ${forcedPoints.join(", ")}`);
    } else {
      // Auto-discover significant timing points
      console.log("\n📋 Discovering timing points...");
      const allPoints = await fetchAllPoints(eventId, appid, tokenRef.value);
      console.log(`   Found ${allPoints.length} total timing points`);

      const startPoint  = allPoints.find((p) => p.isStart === "1");
      const finishPoint = allPoints.find((p) => p.isFinish === "1");

      if (!startPoint) throw new Error("No START point found for this event");
      if (!finishPoint) throw new Error("No FINISH point found for this event");

      // Intermediate = published, not hidden from badges, not the start or finish
      const intermediate = allPoints.filter(
        (p) =>
          p.publish === "1" &&
          p.hide_in_badges !== "1" &&
          p.isStart !== "1" &&
          p.isFinish !== "1"
      );

      console.log(`   START: ${startPoint.name} (${startPoint.label || startPoint.name})`);
      console.log(`   Intermediate: ${intermediate.length} points`);
      for (const p of intermediate) {
        console.log(`     • ${p.name} — "${p.label}" @ ${p.km} km`);
      }
      console.log(`   FINISH: ${finishPoint.name} (${finishPoint.label || finishPoint.name})`);

      // Build leg points array: intermediates + finish (these end each segment)
      const legPoints = [...intermediate, finishPoint];

      // Build the full points-to-fetch list with leg names.
      // Leg name = cleaned point label, with a positional fallback ("Leg N") when
      // the label is non-descriptive (e.g. bare "FINISH" on road race events).
      pointsToFetch = [
        { name: startPoint.name, label: startPoint.label, legName: null, isStart: true, isFinish: false },
        ...legPoints.map((p, i) => ({
          name:     p.name,
          label:    p.label,
          legName:  cleanLabel(p.label || p.name) || `Leg ${i + 1}`,
          isStart:  false,
          isFinish: p.isFinish === "1",
        })),
      ];
    }

    const startPointName  = pointsToFetch.find((p) => p.isStart)?.name;
    const legPointDefs    = pointsToFetch.filter((p) => !p.isStart);
    const legNames        = legPointDefs.map((p) => p.legName);

    console.log(`\n   Legs to compute: ${legNames.join(" → ")}`);

    // ── Fetch splits at all relevant points ───────────────────────────────────
    const splits = {};

    for (let i = 0; i < pointsToFetch.length; i++) {
      const pt = pointsToFetch[i];
      if (i > 0) await new Promise((r) => setTimeout(r, POINT_DELAY));
      process.stdout.write(`\n   Fetching ${pt.name} (${pt.label || pt.name}) splits...`);
      splits[pt.name] = await fetchAllSplitsAtPoint(eventId, pt.name, appid, tokenRef);
      console.log(` ${splits[pt.name].size} records`);
    }

    // ── Build athlete records ─────────────────────────────────────────────────
    const startSplits  = splits[startPointName] ?? new Map();
    const finishPoint  = legPointDefs.find((p) => p.isFinish);
    const finishSplits = splits[finishPoint?.name] ?? new Map();

    // Union of all athlete bibs
    const allBibs = new Set([
      ...startSplits.keys(),
      ...finishSplits.keys(),
    ]);
    console.log(`\n   Total athletes found: ${allBibs.size}`);

    const rows = [];

    for (const bib of allBibs) {
      const startSplit  = startSplits.get(bib);
      const finishSplit = finishSplits.get(bib);

      // Use whichever split has the best profile data
      const profile = finishSplit ?? startSplit;
      if (!profile) continue;

      const hasDNF = !finishSplit;
      const status = hasDNF ? "DNF" : "FIN";

      // Compute individual leg times from cumulative netTime values
      // Each intermediate/finish point's netTime is cumulative chip time from that athlete's start
      const legSecs = [];
      let prevCumSecs = 0;

      for (const legPt of legPointDefs) {
        const split = splits[legPt.name]?.get(bib);
        const cumSecs = parseTime(split?.netTime);
        if (cumSecs != null && prevCumSecs !== null) {
          legSecs.push(Math.max(0, Math.round(cumSecs - prevCumSecs)));
          prevCumSecs = cumSecs;
        } else {
          legSecs.push(null);
          prevCumSecs = null; // can't compute further legs
        }
      }

      const finishCumSecs = parseTime(finishSplit?.netTime);

      // Rankings — handle both IRONMAN-style keys and road-race-style keys
      const results = finishSplit?.results ?? {};
      const overallRank  = results["course"]?.p    ?? results["overall"]?.p  ?? "";
      const genderRank   = results["course-sex"]?.p ?? results["gender"]?.p  ?? "";
      const divisionRank = results["course-sex-division"]?.p ?? results["agegroup"]?.p ?? "";

      // Normalize gender
      const gender = profile.sex === "M" ? "Male" : profile.sex === "F" ? "Female" : "";

      rows.push({
        bib,
        name:        profile.name ?? "",
        gender,
        country:     profile.country_iso?.toUpperCase() ?? profile.country ?? "",
        division:    profile.division ?? "",
        status,
        finishSecs:  finishCumSecs ?? "",
        finishTime:  fmtTime(finishCumSecs),
        legSecs,     // array aligned with legPointDefs
        overallRank,
        genderRank,
        divisionRank,
        startEpoch:      startSplit?.epochTime ?? "",
        startTimeOfDay:  startSplit?.startTime ?? startSplit?.timeOfDay ?? "",
      });
    }

    // Sort by overall rank (finishers first, then DNFs by finish time)
    rows.sort((a, b) => {
      const ra = parseInt(a.overallRank) || 99999;
      const rb = parseInt(b.overallRank) || 99999;
      return ra - rb;
    });

    const finishers = rows.filter((r) => r.status === "FIN").length;
    const dnfs      = rows.filter((r) => r.status === "DNF").length;
    console.log(`   Finishers: ${finishers} | DNFs: ${dnfs}`);

    // ── Write results CSV ─────────────────────────────────────────────────────
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

    // Build headers: fixed columns + dynamic leg time columns + ranks + seconds columns
    const headers = [
      "Bib Number", "Athlete Name", "Gender", "Country", "Division", "Status",
      "Finish Time",
      ...legNames.map((l) => `${l} Time`),
      "Overall Rank", "Gender Rank", "Division Rank",
      "Finish (Seconds)",
      ...legNames.map((l) => `${l} (Seconds)`),
    ];

    const csvRows = rows.map((r) => {
      const cols = [
        r.bib, r.name, r.gender, r.country, r.division, r.status,
        r.finishTime,
        ...r.legSecs.map((s) => fmtTime(s)),
        r.overallRank, r.genderRank, r.divisionRank,
        r.finishSecs,
        ...r.legSecs.map((s) => s ?? ""),
      ];
      return cols.map(esc).join(",");
    });

    const resultsCsv  = [headers.join(","), ...csvRows].join("\n");
    const resultsFile = path.join(outputDir, `${eventId}.csv`);
    await fs.writeFile(resultsFile, resultsCsv);
    console.log(`\n✅ Results written to: ${resultsFile}`);

    // ── Write starts CSV ──────────────────────────────────────────────────────
    const startHeaders = ["Bib", "Name", "Division", "Sex", "StartEpoch", "StartTimeOfDay"];
    const startCsvRows = rows
      .filter((r) => r.startEpoch)
      .map((r) => [
        r.bib, r.name, r.division,
        r.gender === "Male" ? "M" : r.gender === "Female" ? "F" : "",
        r.startEpoch, r.startTimeOfDay,
      ].map(esc).join(","));
    const startsCsv  = [startHeaders.join(","), ...startCsvRows].join("\n");
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
