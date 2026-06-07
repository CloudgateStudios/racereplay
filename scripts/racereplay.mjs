#!/usr/bin/env node
/**
 * racereplay.mjs
 *
 * Fetches race data from RTRT.me and runs the leg-by-leg physical passing
 * algorithm, producing a _passing.csv ready for ingestion.
 *
 * Split data for each timing point is written to disk as it is fetched so the
 * run is resumable — if the process dies mid-fetch, re-running will skip any
 * points whose cache files already exist.
 *
 * Usage:
 *   node scripts/racereplay.mjs <event-id> [options]
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
 *   --verify             After running the fast O(n log n) algorithm, also run
 *                        the O(n²) reference algorithm and diff the results.
 *                        Use this when validating algorithm changes.
 *
 * Examples:
 *   # Shamrock Shuffle 2026 (Bank of America — uses a different app ID)
 *   node scripts/racereplay.mjs BASS2026 --appid 4d9df5bf9f36bc4a1dc8fce2
 *
 *   # Any IRONMAN event (uses default IRONMAN app ID)
 *   node scripts/racereplay.mjs IRM-OCEANSIDE703-2026
 *
 *   # Verify the fast algorithm matches the reference on a cached event
 *   node scripts/racereplay.mjs IRM-OCEANSIDE703-2026 --verify
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IRONMAN_APPID = "5824c5c948fd08c23a8b4567";
const API         = "https://api.rtrt.me";
const UA          = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const PAGE        = 20;   // records per API page (RTRT caps at 20 regardless of count param)
const DELAY       = 100;  // ms between page requests within a single timing point
const CONCURRENCY = 4;    // timing points fetched in parallel

// ─── Fetch Helpers ────────────────────────────────────────────────────────────

/**
 * Makes a GET request to the RTRT API and returns the parsed JSON body.
 * Throws if the HTTP response is not 2xx.
 *
 * @param {string} p - Path + query string, e.g. "/events/FOO/points?appid=...&token=..."
 * @returns {Promise<object>}
 */
async function rtrtFetch(p) {
  const res = await fetch(`${API}${p}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`RTRT ${p} → HTTP ${res.status}`);
  return res.json();
}

/**
 * Registers with the RTRT API for a given app and returns a session token.
 * Tokens are short-lived; each concurrent worker should hold its own.
 *
 * @param {string} appid
 * @returns {Promise<string>} session token
 */
async function register(appid) {
  const data = await rtrtFetch(`/register?appid=${appid}`);
  if (!data.token) throw new Error(`Registration failed: ${JSON.stringify(data)}`);
  return data.token;
}

/**
 * Parses a time string in "H:MM:SS.sss" or "MM:SS.sss" format into total
 * seconds as a float. Returns null if the string is missing or malformed.
 *
 * @param {string|null|undefined} t
 * @returns {number|null}
 */
function parseTime(t) {
  if (!t) return null;
  const parts = t.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

/**
 * Formats a duration in seconds to "H:MM:SS" (if >= 1 hour) or "M:SS".
 * Returns "--:--:--" for null/undefined input.
 *
 * @param {number|null} secs
 * @returns {string}
 */
function fmtTimeLong(secs) {
  if (secs == null) return "--:--:--";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Strips a timing point label down to a clean, CSV-friendly leg name.
 *   "Run/Finish"       → "Run"      (takes the part before "/")
 *   "Bike 56mi | 89km" → "Bike 56mi" (takes the part before "|")
 *   "FINISH" / "START" → ""          (caller supplies a positional fallback)
 *
 * @param {string} label
 * @returns {string}
 */
function cleanLabel(label) {
  const clean = (label || "").split("/")[0].split("|")[0].trim();
  if (/^(finish|start)$/i.test(clean)) return "";
  return clean;
}

/**
 * Fetches all timing point definitions for an event, paginating as needed.
 * Returns them sorted by distance (km) ascending.
 *
 * @param {string} eventId
 * @param {string} appid
 * @param {string} token
 * @returns {Promise<object[]>}
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

  return allPoints.sort((a, b) => parseFloat(a.km || 0) - parseFloat(b.km || 0));
}

/**
 * Fetches every split record for a single timing point, paginating through
 * all pages. Writes a progress line to stdout every LOG_EVERY pages.
 *
 * On network-level failures (ECONNRESET, ETIMEDOUT, etc.) or RTRT API errors,
 * retries up to 3 times with exponential back-off (5s / 10s / 15s), refreshing
 * the session token before each retry.
 *
 * @param {string}  eventId    - RTRT event ID
 * @param {string}  pointName  - Timing point name, e.g. "START" or "5K"
 * @param {string}  appid      - RTRT app ID
 * @param {{value: string}} tokenRef - Mutable token holder; updated on retry
 * @param {number}  [hintTotal=0] - Expected total athletes (used to estimate page count)
 * @param {string}  [logPrefix="   "] - Prefix for progress log lines
 * @returns {Promise<Map<string, object>>} Map of bib → split record
 */
async function fetchAllSplitsAtPoint(eventId, pointName, appid, tokenRef, hintTotal = 0, logPrefix = "   ") {
  const map        = new Map();
  let   start      = 1;
  let   retries    = 0;
  const estPages   = hintTotal > 0 ? Math.ceil(hintTotal / PAGE) : 0;
  const pointStart = Date.now();
  const LOG_EVERY  = 50; // print a progress line every N pages

  const progress = (page, records) => {
    if (page % LOG_EVERY !== 0 && page !== 1) return;
    const elapsed = ((Date.now() - pointStart) / 1000).toFixed(0);
    const pageStr = estPages > 0 ? `page ${page}/${estPages}` : `page ${page}`;
    console.log(`${logPrefix}⏳ ${pageStr}  •  ${records} records  •  ${elapsed}s elapsed`);
  };

  while (true) {
    const qs  = `appid=${appid}&token=${tokenRef.value}`;
    const url = `/events/${eventId}/points/${pointName}/splits?${qs}&start=${start}`;

    let data;
    try {
      data = await rtrtFetch(url);
    } catch (networkErr) {
      if (retries < 3) {
        retries++;
        const wait = retries * 5000;
        process.stdout.write(`\n${logPrefix}[network retry ${retries} in ${wait / 1000}s: ${networkErr.message}]`);
        await new Promise((r) => setTimeout(r, wait));
        tokenRef.value = await register(appid);
        continue;
      }
      throw networkErr;
    }

    if (data.error) {
      const type = data.error.type ?? "";
      const msg  = data.error.msg  ?? "";
      // Terminal errors — point has no data, treat as empty
      if (type === "no_results" || type === "access_denied" || msg.toLowerCase().includes("not found")) {
        return map;
      }
      // Transient errors — retry with token refresh
      if (retries < 3) {
        retries++;
        const wait = retries * 5000;
        process.stdout.write(`\n${logPrefix}[retry ${retries} in ${wait / 1000}s]`);
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
    const page = Math.ceil(start / PAGE);
    progress(page, map.size);
    if (data.list.length < PAGE) break;

    start = parseInt(data.info?.last ?? start) + 1;
    await new Promise((r) => setTimeout(r, DELAY));
  }

  return map;
}

// ─── Analysis Helpers ─────────────────────────────────────────────────────────

/**
 * Prepares athletes for the passing algorithm by:
 *   1. Assigning wave offsets from RTRT per-athlete start epochs when available,
 *      falling back to the median offset for the athlete's division.
 *   2. Computing each athlete's cumulative "position" at each leg checkpoint
 *      as waveOffset + cumulativeChipTime. This is the value used for ranking.
 *
 * Returns the mutated athletes array alongside a flag indicating whether any
 * meaningful wave/start-time data was found (determines gun-start vs physical-
 * passing mode in the algorithm).
 *
 * @param {object[]} athletes
 * @param {string[]} legNames
 * @param {Map<string, number>|null} rtrtStarts - Map of bib → Unix epoch start time, or null
 * @returns {{ athletes: object[], hasWaveData: boolean }}
 */
function normalizeAthletes(athletes, legNames, rtrtStarts) {
  // Step 1: convert absolute epoch times to seconds-since-first-wave offsets
  if (rtrtStarts) {
    const epochs   = athletes.map((a) => a.startEpoch).filter((e) => e != null);
    const minEpoch = epochs.length ? Math.min(...epochs) : 0;
    for (const a of athletes) {
      if (a.startEpoch != null) {
        a.waveOffset = Math.round((a.startEpoch - minEpoch) * 1000) / 1000;
      }
    }
  }

  // Step 2: fill in missing wave offsets using the median for the athlete's division
  const offsetsByDiv = new Map();
  for (const a of athletes) {
    if (a.waveOffset == null) continue;
    if (!offsetsByDiv.has(a.division)) offsetsByDiv.set(a.division, []);
    offsetsByDiv.get(a.division).push(a.waveOffset);
  }

  const medianOffset = (arr) => {
    if (!arr?.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid    = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  };

  for (const a of athletes) {
    if (a.waveOffset != null) continue;
    const divOffsets = offsetsByDiv.get(a.division);
    a.waveOffset = divOffsets?.length ? medianOffset(divOffsets) : 0;
  }

  // Step 3: compute cumulative position at each leg checkpoint
  for (const a of athletes) {
    let cumChip = 0;
    for (const leg of legNames) {
      const v = a.legSecs[leg];
      if (v != null && cumChip !== null) {
        cumChip += v;
        a.cumPositions[leg] = a.waveOffset + cumChip;
      } else {
        cumChip = null;
        a.cumPositions[leg] = null;
      }
    }
  }

  const hasWaveData =
    (rtrtStarts && rtrtStarts.size > 0) ||
    athletes.some((a) => a.waveOffset != null && a.waveOffset !== 0);

  return { athletes, hasWaveData };
}

/**
 * Ranks athletes by a time-getter function. Athletes for whom the getter
 * returns null are excluded. Rank 1 = fastest (lowest value).
 *
 * @param {object[]} athletes
 * @param {(a: object) => number|null} getTime
 * @returns {Map<string, number>} bib → 1-based rank
 */
function buildRankMap(athletes, getTime) {
  const eligible = athletes.filter((a) => getTime(a) != null);
  const sorted   = [...eligible].sort((a, b) => getTime(a) - getTime(b));
  const map      = new Map();
  sorted.forEach((a, i) => map.set(a.bib, i + 1));
  return map;
}

// ─── Fenwick Tree (Binary Indexed Tree) ───────────────────────────────────────

/**
 * Standard 1-based Fenwick Tree supporting point updates and prefix-sum
 * queries, both in O(log n). Used to count rank inversions in O(n log n).
 */
class FenwickTree {
  /** @param {number} size - Maximum index that will be queried or updated */
  constructor(size) {
    this._t = new Int32Array(size + 1);
    this._n = size;
  }
  /** Adds delta at position i (1-based). */
  update(i, delta = 1) {
    for (; i <= this._n; i += i & -i) this._t[i] += delta;
  }
  /** Returns the prefix sum from index 1 to i (inclusive). */
  query(i) {
    let s = 0;
    for (; i > 0; i -= i & -i) s += this._t[i];
    return s;
  }
  /** Resets all values to zero, allowing the tree to be reused. */
  reset() {
    this._t.fill(0);
  }
}

/**
 * Computes leg-by-leg passing counts for every athlete in O(n log n) per leg
 * using a Fenwick tree to count rank inversions.
 *
 * A "pass" is defined physically: athlete x gained a position on y during a leg
 * if y was ranked ahead of x at the start of the leg but behind x at the end.
 *
 * Algorithm (per leg):
 *   - Compress beforeRanks to [1..n] within the eligible set to keep the tree
 *     within bounds (global ranks from buildRankMap can exceed eligible.length).
 *   - Pass A (descending afterRank): when processing x, all already-inserted
 *     athletes finished worse. gained[x] = tree.query(xBefore - 1).
 *   - Pass B (ascending afterRank): when processing x, all already-inserted
 *     athletes finished better. lost[x] = inserted - tree.query(xBefore).
 *   - Gun-start leg (no wave data): closed-form — gained = n - afterRank,
 *     lost = afterRank - 1.
 *
 * @param {object[]} athletes        - Normalized athlete records with cumPositions
 * @param {string[]} legNames
 * @param {boolean}  [hasWaveData=false]
 * @returns {Map<string, object>} bib → { [legName]: { gained, lost } }
 */
function computePassingDataFast(athletes, legNames, hasWaveData = false) {
  const legs = legNames.map((name, i) => ({
    name,
    getBefore: i === 0
      ? hasWaveData ? (a) => a.waveOffset : null
      : (a) => a.cumPositions[legNames[i - 1]],
    getAfter: (a) => a.cumPositions[name],
  }));

  const results = new Map();
  for (const a of athletes) {
    const entry = {};
    for (const leg of legNames) entry[leg] = { gained: 0, lost: 0 };
    results.set(a.bib, entry);
  }

  for (const leg of legs) {
    const afterMap   = buildRankMap(athletes, leg.getAfter);
    let   eligible   = athletes.filter((a) => afterMap.has(a.bib));
    const isGunStart = leg.name === legNames[0] && !hasWaveData;

    if (isGunStart) {
      // Everyone started at the same position — closed-form counts
      for (const x of eligible) {
        const xAfter  = afterMap.get(x.bib);
        const legData = results.get(x.bib)[leg.name];
        legData.gained = eligible.length - xAfter;
        legData.lost   = xAfter - 1;
      }
      continue;
    }

    const beforeMap = buildRankMap(athletes, leg.getBefore);
    eligible = eligible.filter((a) => beforeMap.has(a.bib));
    if (eligible.length === 0) continue;

    const n    = eligible.length;
    const tree = new FenwickTree(n);

    // Compress beforeRank to [1..n] preserving relative order.
    // Global ranks from buildRankMap can exceed eligible.length, causing
    // out-of-bounds Int32Array reads (returns undefined → NaN in arithmetic).
    const localBefore = new Map(
      [...eligible]
        .sort((a, b) => beforeMap.get(a.bib) - beforeMap.get(b.bib))
        .map((a, i) => [a.bib, i + 1])
    );

    // Pass A — gained (worst-after-rank first)
    for (const x of [...eligible].sort((a, b) => afterMap.get(b.bib) - afterMap.get(a.bib))) {
      const xBefore = localBefore.get(x.bib);
      results.get(x.bib)[leg.name].gained = xBefore > 1 ? tree.query(xBefore - 1) : 0;
      tree.update(xBefore);
    }

    // Pass B — lost (best-after-rank first)
    tree.reset();
    let inserted = 0;
    for (const x of [...eligible].sort((a, b) => afterMap.get(a.bib) - afterMap.get(b.bib))) {
      const xBefore = localBefore.get(x.bib);
      results.get(x.bib)[leg.name].lost = inserted - tree.query(xBefore);
      tree.update(xBefore);
      inserted++;
    }
  }

  return results;
}

/**
 * Reference O(n²) passing algorithm — kept solely for use with --verify.
 * Semantically identical to computePassingDataFast but uses a brute-force
 * nested loop. Do not use on large events (54k athletes × 18 legs ≈ hours).
 *
 * @param {object[]} athletes
 * @param {string[]} legNames
 * @param {boolean}  [hasWaveData=false]
 * @returns {Map<string, object>} bib → { [legName]: { gained, lost } }
 */
function computePassingData(athletes, legNames, hasWaveData = false) {
  const legs = legNames.map((name, i) => ({
    name,
    getBefore: i === 0
      ? hasWaveData ? (a) => a.waveOffset : null
      : (a) => a.cumPositions[legNames[i - 1]],
    getAfter: (a) => a.cumPositions[name],
  }));

  const results = new Map();
  for (const a of athletes) {
    const entry = {};
    for (const leg of legNames) entry[leg] = { gained: 0, lost: 0 };
    results.set(a.bib, entry);
  }

  for (const leg of legs) {
    const afterMap   = buildRankMap(athletes, leg.getAfter);
    const eligible   = athletes.filter((a) => afterMap.has(a.bib));
    const isGunStart = leg.name === legNames[0] && !hasWaveData;

    let beforeMap;
    if (isGunStart) {
      beforeMap = new Map(eligible.map((a) => [a.bib, 1]));
    } else {
      beforeMap = buildRankMap(athletes, leg.getBefore);
      eligible.splice(0, eligible.length, ...eligible.filter((a) => beforeMap.has(a.bib)));
    }

    for (const x of eligible) {
      const xBefore = beforeMap.get(x.bib);
      const xAfter  = afterMap.get(x.bib);
      const legData = results.get(x.bib)[leg.name];

      for (const y of eligible) {
        if (y.bib === x.bib) continue;
        const yBefore = beforeMap.get(y.bib);
        const yAfter  = afterMap.get(y.bib);
        if (yBefore == null || yAfter == null) continue;

        if (isGunStart) {
          if (yAfter > xAfter) legData.gained++;
          else if (yAfter < xAfter) legData.lost++;
        } else {
          if (yBefore < xBefore && yAfter > xAfter) legData.gained++;
          else if (yBefore > xBefore && yAfter < xAfter) legData.lost++;
        }
      }
    }
  }

  return results;
}

// ─── Report & Output ──────────────────────────────────────────────────────────

/** Left-pads str to len characters (for aligned terminal columns). */
function pad(str, len)  { return String(str).padEnd(len, " ").slice(0, len); }

/** Right-pads str to len characters (for aligned terminal columns). */
function rpad(str, len) { return String(str).padStart(len, " ").slice(-len); }

/**
 * Prints a summary header and the per-leg invariant check to stdout.
 * The invariant asserts that sum(gained) === sum(lost) for each leg across all
 * athletes — a necessary condition for a correct passing algorithm.
 *
 * @param {object[]} athletes
 * @param {Map<string, object>} passingMap
 * @param {string[]} legNames
 * @param {boolean}  hasWaveData
 */
function printReport(athletes, passingMap, legNames, hasWaveData) {
  const finishers  = athletes.filter((a) => a.status === "FIN" && a.finishSecs != null);
  const dnfs       = athletes.filter((a) => a.status === "DNF");
  const rtrtCount  = athletes.filter((a) => a.startEpoch != null).length;

  const modeLabel = rtrtCount > 0
    ? `✅ Physical passing — RTRT start times (${rtrtCount} athletes matched)`
    : hasWaveData
      ? "✅ Physical passing — wave offsets applied"
      : "⚠️  Chip time only — no start time data";

  console.log("\n" + "═".repeat(70));
  console.log("  RACEREPLAY — Passing Analysis");
  console.log("═".repeat(70));
  console.log(`  Athletes:  ${athletes.length}`);
  console.log(`  Finishers: ${finishers.length}`);
  console.log(`  DNFs:      ${dnfs.length}`);
  console.log(`  Legs:      ${legNames.join(", ")}`);
  console.log(`  Mode:      ${modeLabel}`);
  console.log("═".repeat(70));

  console.log("\n📐 INVARIANT CHECK  (sum of gained must equal sum of lost per leg)");
  console.log("─".repeat(50));

  let invariantOk = true;
  for (const leg of legNames) {
    let totalGained = 0;
    let totalLost   = 0;
    for (const data of passingMap.values()) {
      totalGained += data[leg].gained;
      totalLost   += data[leg].lost;
    }
    const ok   = totalGained === totalLost;
    if (!ok) invariantOk = false;
    const icon = ok ? "✅" : "❌";
    console.log(
      `  ${icon}  ${pad(leg.toUpperCase(), 8)}  gained=${rpad(totalGained, 7)}  lost=${rpad(totalLost, 7)}  ${ok ? "MATCH" : "MISMATCH ← BUG"}`
    );
  }
  console.log(`\n  Overall invariant: ${invariantOk ? "✅ PASS" : "❌ FAIL"}`);
  console.log("\n" + "═".repeat(70) + "\n");
}

/**
 * Builds the full passing CSV as a string. Each row contains athlete profile
 * fields, leg split times, wave offset, per-leg gained/lost/net counts, and
 * an overall net positions figure.
 *
 * @param {object[]} athletes
 * @param {Map<string, object>} passingMap
 * @param {string[]} legNames
 * @returns {string} CSV content (headers + rows, newline-separated)
 */
function buildOutputCSV(athletes, passingMap, legNames) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const headers = [
    "Bib", "Name", "Gender", "Country", "Division", "Status",
    "Overall Rank", "Gender Rank", "Division Rank",
    "Finish Time",
    ...legNames.map((l) => `${l} Time`),
    "Wave Offset (Seconds)",
    ...legNames.flatMap((l) => [`${l} Gained`, `${l} Lost`, `${l} Net`]),
    "Overall Net",
  ];

  const rows = athletes.map((a) => {
    const d          = passingMap.get(a.bib);
    const overallNet = d ? legNames.reduce((sum, l) => sum + d[l].gained - d[l].lost, 0) : 0;

    const row = [
      a.bib, a.name, a.gender, a.country, a.division, a.status,
      a.overallRank ?? "", a.genderRank ?? "", a.divisionRank ?? "",
      fmtTimeLong(a.finishSecs),
      ...legNames.map((l) => fmtTimeLong(a.legSecs[l])),
      a.waveOffset ?? 0,
    ];

    if (d) {
      for (const leg of legNames) {
        const net = d[leg].gained - d[leg].lost;
        row.push(d[leg].gained, d[leg].lost, net);
      }
      row.push(overallNet);
    } else {
      for (let i = 0; i < legNames.length * 3 + 1; i++) row.push("");
    }

    return row.map(esc).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args         = process.argv.slice(2);
const eventId      = args.find((a) => !a.startsWith("--"));
const appidIdx     = args.indexOf("--appid");
const appid        = appidIdx !== -1 ? args[appidIdx + 1] : IRONMAN_APPID;
const outdirIdx    = args.indexOf("--output-dir");
const outputDir    = outdirIdx !== -1 ? args[outdirIdx + 1] : path.join(__dirname, "data");
const pointsIdx    = args.indexOf("--points");
const forcedPoints = pointsIdx !== -1 ? args[pointsIdx + 1]?.split(",").map((p) => p.trim()) : null;
const verifyMode   = args.includes("--verify");

if (!eventId) {
  console.error(`
Usage: node scripts/racereplay.mjs <event-id> [options]

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
  --verify             Run the O(n²) reference algorithm after the fast algorithm
                       and diff the results to confirm correctness.

Examples:
  # Shamrock Shuffle 2026
  node scripts/racereplay.mjs BASS2026 --appid 4d9df5bf9f36bc4a1dc8fce2

  # Any IRONMAN event
  node scripts/racereplay.mjs IRM-OCEANSIDE703-2026
`);
  process.exit(1);
}

(async () => {
  try {
    await fs.mkdir(outputDir, { recursive: true });

    console.log("🔑 Registering with RTRT.me...");
    const tokenRef = { value: await register(appid) };

    const event = await rtrtFetch(`/events/${eventId}?appid=${appid}&token=${tokenRef.value}`);
    if (event.error) throw new Error(`Event not found: ${event.error.msg}`);
    console.log(`\n📍 Event: ${event.desc} (${event.date})`);
    console.log(`   Location: ${event.loc?.desc ?? "unknown"}`);
    console.log(`   Finishers reported: ${event.finishers ?? "unknown"}`);

    // ── Determine timing points ───────────────────────────────────────────────
    let pointsToFetch;

    if (forcedPoints) {
      pointsToFetch = forcedPoints.map((name, i) => ({
        name,
        label:    name,
        legName:  name,
        isStart:  i === 0,
        isFinish: i === forcedPoints.length - 1,
      }));
      console.log(`\n📋 Using specified points: ${forcedPoints.join(", ")}`);
    } else {
      console.log("\n📋 Discovering timing points...");
      const allPoints = await fetchAllPoints(eventId, appid, tokenRef.value);
      console.log(`   Found ${allPoints.length} total timing points`);

      const startPoint  = allPoints.find((p) => p.isStart  === "1");
      const finishPoint = allPoints.find((p) => p.isFinish === "1");
      if (!startPoint)  throw new Error("No START point found for this event");
      if (!finishPoint) throw new Error("No FINISH point found for this event");

      // Include transitions (T1, T2) even if hide_in_badges is set
      const isTransition = (p) => /^T\d+$/i.test(p.name) || /^T\d+$/i.test(p.label);
      const intermediate = allPoints.filter(
        (p) =>
          p.publish === "1" &&
          (p.hide_in_badges !== "1" || isTransition(p)) &&
          p.isStart  !== "1" &&
          p.isFinish !== "1"
      );

      console.log(`   START: ${startPoint.name} (${startPoint.label || startPoint.name})`);
      console.log(`   Intermediate: ${intermediate.length} points`);
      for (const p of intermediate) {
        console.log(`     • ${p.name} — "${p.label}" @ ${p.km} km`);
      }
      console.log(`   FINISH: ${finishPoint.name} (${finishPoint.label || finishPoint.name})`);

      const legPoints = [...intermediate, finishPoint];
      pointsToFetch = [
        { name: startPoint.name, label: startPoint.label, legName: null, isStart: true,  isFinish: false },
        ...legPoints.map((p, i) => ({
          name:     p.name,
          label:    p.label,
          legName:  cleanLabel(p.label || p.name) || `Leg ${i + 1}`,
          isStart:  false,
          isFinish: p.isFinish === "1",
        })),
      ];
    }

    const startPointName = pointsToFetch.find((p) => p.isStart)?.name;
    const legPointDefs   = pointsToFetch.filter((p) => !p.isStart);
    const legNames       = legPointDefs.map((p) => p.legName);

    console.log(`\n   Legs to compute: ${legNames.join(" → ")}`);

    // ── Helpers: persist and load per-point split files ───────────────────────
    // Each timing point's splits are written to {eventId}_splits_{pointName}.json
    // immediately after fetching. On re-run, any file that already exists is
    // loaded from disk instead of re-fetched, making the process resumable.

    const splitFile = (ptName) =>
      path.join(outputDir, `${eventId}_splits_${ptName}.json`);

    async function saveSplits(ptName, map) {
      const arr = [...map.entries()].map(([bib, rec]) => ({ bib, ...rec }));
      await fs.writeFile(splitFile(ptName), JSON.stringify(arr));
    }

    async function loadSplits(ptName) {
      const raw = await fs.readFile(splitFile(ptName), "utf8");
      const arr = JSON.parse(raw);
      const map = new Map();
      for (const rec of arr) {
        const { bib, ...rest } = rec;
        map.set(String(bib), rest);
      }
      return map;
    }

    async function splitFileExists(ptName) {
      try { await fs.access(splitFile(ptName)); return true; } catch { return false; }
    }

    // ── Fetch splits (parallel, skip cached points) ───────────────────────────
    const hintTotal  = event.finishers ? parseInt(event.finishers, 10) : 0;
    const fetchStart = Date.now();
    let   completed  = 0;

    // Separate already-cached points from those still needing a fetch
    const toFetch = [];
    for (let i = 0; i < pointsToFetch.length; i++) {
      const pt = pointsToFetch[i];
      if (await splitFileExists(pt.name)) {
        console.log(`   [${i + 1}/${pointsToFetch.length}] ${pt.name} — cached ✓`);
      } else {
        toFetch.push({ pt, idx: i });
      }
    }

    if (toFetch.length === 0) {
      console.log("\n   All points cached — skipping fetch.");
    } else {
      console.log(`\n   Fetching ${toFetch.length} point(s) with concurrency=${CONCURRENCY}...\n`);

      // Each worker gets its own token to avoid concurrent token-refresh races
      const tokens    = await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, () => register(appid))
      );
      const tokenRefs = tokens.map((value) => ({ value }));
      const queue     = [...toFetch];

      async function runWorker(workerToken) {
        while (queue.length > 0) {
          const { pt, idx } = queue.shift();
          const prefix      = `   [${idx + 1}/${pointsToFetch.length}] ${pt.name.padEnd(8)} `;
          console.log(`${prefix}starting...`);
          const ptStart = Date.now();

          const map = await fetchAllSplitsAtPoint(eventId, pt.name, appid, workerToken, hintTotal, prefix);
          await saveSplits(pt.name, map);

          completed++;
          const ptSecs  = ((Date.now() - ptStart) / 1000).toFixed(1);
          const elapsed = ((Date.now() - fetchStart) / 1000).toFixed(0);
          const left    = toFetch.length - completed;
          const avgSecs = (Date.now() - fetchStart) / 1000 / completed;
          const etaSecs = Math.round(left * avgSecs);
          const eta     = etaSecs > 60 ? `~${Math.round(etaSecs / 60)}m` : `~${etaSecs}s`;
          console.log(`${prefix}✅ ${map.size} records in ${ptSecs}s  •  ${elapsed}s total  •  ${left > 0 ? eta + " remaining" : "all done"}`);
        }
      }

      await Promise.all(tokenRefs.map((tr) => runWorker(tr)));
    }

    // ── Build athlete records (load split files on demand) ────────────────────
    // START and FINISH are loaded upfront to enumerate all bibs. Intermediate
    // point files are loaded one at a time as each leg is processed, keeping
    // peak memory around 3 Maps rather than all points simultaneously.

    console.log("\n   Loading START and FINISH splits...");
    const startSplits  = await loadSplits(startPointName);
    const finishPtDef  = legPointDefs.find((p) => p.isFinish);
    const finishSplits = await loadSplits(finishPtDef?.name);

    const allBibs = new Set([...startSplits.keys(), ...finishSplits.keys()]);
    console.log(`   Total athletes found: ${allBibs.size}`);

    const splitsCache = new Map();
    splitsCache.set(startPointName,   startSplits);
    splitsCache.set(finishPtDef?.name, finishSplits);

    async function getSplits(ptName) {
      if (!splitsCache.has(ptName)) splitsCache.set(ptName, await loadSplits(ptName));
      return splitsCache.get(ptName);
    }

    const athletes   = [];
    const rtrtStarts = new Map();

    for (const bib of allBibs) {
      const startSplit  = startSplits.get(bib);
      const finishSplit = finishSplits.get(bib);
      const profile     = finishSplit ?? startSplit;
      if (!profile) continue;

      // Compute leg split times as differences between consecutive cumulative times
      const legSecs = {};
      let prevCumSecs = 0;
      for (const legPt of legPointDefs) {
        const ptSplits  = await getSplits(legPt.name);
        const split     = ptSplits.get(bib);
        const cumSecs   = parseTime(split?.netTime);
        if (cumSecs != null && prevCumSecs !== null) {
          legSecs[legPt.legName] = Math.max(0, Math.round(cumSecs - prevCumSecs));
          prevCumSecs = cumSecs;
        } else {
          legSecs[legPt.legName] = null;
          prevCumSecs = null;
        }
      }

      const finishCumSecs  = parseTime(finishSplit?.netTime);
      const results        = finishSplit?.results ?? {};
      const overallRank    = results["course"]?.p              ?? results["overall"]?.p   ?? null;
      const genderRank     = results["course-sex"]?.p          ?? results["gender"]?.p    ?? null;
      const divisionRank   = results["course-sex-division"]?.p ?? results["agegroup"]?.p  ?? null;
      const gender         = profile.sex === "M" ? "Male" : profile.sex === "F" ? "Female" : "";
      const startEpoch     = startSplit?.epochTime ? parseFloat(startSplit.epochTime) : null;

      if (startEpoch != null) rtrtStarts.set(bib, startEpoch);

      athletes.push({
        bib,
        name:         profile.name ?? "",
        gender,
        country:      profile.country_iso?.toUpperCase() ?? profile.country ?? "",
        division:     profile.division ?? "",
        status:       finishSplit ? "FIN" : "DNF",
        overallRank:  overallRank  != null ? parseInt(overallRank,  10) : null,
        genderRank:   genderRank   != null ? parseInt(genderRank,   10) : null,
        divisionRank: divisionRank != null ? parseInt(divisionRank, 10) : null,
        finishSecs:   finishCumSecs ?? null,
        legSecs,
        startEpoch,
        waveOffset:   null,
        cumPositions: {},
      });
    }

    athletes.sort((a, b) => (a.overallRank ?? 99999) - (b.overallRank ?? 99999));

    const finisherCount = athletes.filter((a) => a.status === "FIN").length;
    const dnfCount      = athletes.filter((a) => a.status === "DNF").length;
    console.log(`   Finishers: ${finisherCount} | DNFs: ${dnfCount}`);

    // ── Run passing analysis ──────────────────────────────────────────────────
    console.log("\n⚙️  Running passing analysis...");

    const hasRtrt = rtrtStarts.size > 0;
    const { athletes: normalizedAthletes, hasWaveData } = normalizeAthletes(
      athletes,
      legNames,
      hasRtrt ? rtrtStarts : null
    );

    const modeMsg = hasRtrt
      ? `RTRT start times matched to ${rtrtStarts.size}/${athletes.length} athletes — physical passing mode active.`
      : "No per-athlete start times — using chip time comparisons only.";
    console.log(`   ${modeMsg}`);

    const passingMap = computePassingDataFast(normalizedAthletes, legNames, hasWaveData);

    // Optional: diff fast algorithm against O(n²) reference to verify correctness
    if (verifyMode) {
      console.log("\n🔍 --verify: running O(n²) reference algorithm to diff results...");
      const refMap     = computePassingData(normalizedAthletes, legNames, hasWaveData);
      let   mismatches = 0;

      for (const a of normalizedAthletes) {
        const fast = passingMap.get(a.bib);
        const ref  = refMap.get(a.bib);
        if (!fast || !ref) continue;
        for (const leg of legNames) {
          if (fast[leg].gained !== ref[leg].gained || fast[leg].lost !== ref[leg].lost) {
            if (mismatches === 0) console.log("   BIB       LEG      FAST gained/lost  REF gained/lost");
            console.log(
              `   ${String(a.bib).padEnd(9)} ${leg.padEnd(8)} ` +
              `fast=${fast[leg].gained}/${fast[leg].lost}  ref=${ref[leg].gained}/${ref[leg].lost}`
            );
            if (++mismatches >= 20) { console.log("   ... (truncated at 20 mismatches)"); break; }
          }
        }
        if (mismatches >= 20) break;
      }

      if (mismatches === 0) {
        console.log("   ✅ PASS — fast and reference algorithms produce identical results.");
      } else {
        console.log(`\n   ❌ FAIL — ${mismatches} mismatch(es) found. Results written using fast algorithm.`);
      }
    }

    printReport(normalizedAthletes, passingMap, legNames, hasWaveData);

    // ── Write output ──────────────────────────────────────────────────────────
    const outputFile = path.join(outputDir, `${eventId}_passing.csv`);
    await fs.writeFile(outputFile, buildOutputCSV(normalizedAthletes, passingMap, legNames));
    console.log(`📄 Passing data written to: ${outputFile}`);

    console.log(`
Next step:
  cd app
  npx tsx scripts/ingest.ts ../${path.relative(path.join(__dirname, ".."), outputFile)} \\
    --slug <slug> \\
    --race-name "<Race Name>" \\
    --year <YYYY> \\
    --event-type <triathlon|road_race> \\
    --event-date <YYYY-MM-DD>
`);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    if (process.env.DEBUG) {
      console.error(err.stack);
      if (err.cause) console.error("Cause:", err.cause);
    }
    process.exit(1);
  }
})();
