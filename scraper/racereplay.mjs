#!/usr/bin/env node
/**
 * racereplay.mjs
 *
 * Fetches race data from RTRT.me and runs the leg-by-leg physical passing
 * algorithm, producing a _passing.csv ready for ingestion.
 *
 * Split data for each timing point is written to disk atomically as it is
 * fetched, making the run resumable — if the process dies mid-fetch, re-running
 * will skip any points whose cache files already exist. Use --fresh to force a
 * full re-fetch regardless of cached files.
 *
 * Usage:
 *   node scraper/racereplay.mjs <event-id> --appid <id> [options]
 *
 * Options:
 *   --appid <id>          RTRT app ID for this event's tracker app. Required.
 *                         Find it at track.rtrt.me/e/<event-id> (view page
 *                         source, search for "appid").
 *   --output-dir <dir>    Directory to write output files (default: scraper/data/)
 *   --points <list>       Comma-separated list of point names to use, in order.
 *                         Overrides auto-discovery. Must include the finish point.
 *                         Example: --points START,SWIM,T1,BIKE,T2,FINISH
 *   --concurrency <n>     Number of timing points to fetch in parallel (default: 4).
 *                         Higher values are faster but risk rate-limiting.
 *   --fresh               Ignore existing split cache files and re-fetch everything.
 *   --verify              After running the fast O(n log n) algorithm, also run
 *                         the O(n²) reference algorithm and diff the results.
 *                         Use this when validating algorithm changes.
 *
 * Examples:
 *   node scraper/racereplay.mjs <event-id> --appid <id>
 *   node scraper/racereplay.mjs <event-id> --appid <id> --points START,SWIM,T1,BIKE,T2,FINISH
 *   node scraper/racereplay.mjs <event-id> --appid <id> --fresh
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// App IDs are not stored in source — pass --appid on every invocation.
const API = "https://api.rtrt.me";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const PAGE = 20; // records per API page (RTRT caps at 20 regardless of count param)
const DELAY = 100; // ms between page requests within a single timing point
const DEFAULT_CONCURRENCY = 4; // timing points fetched in parallel (overridable via --concurrency)

// ─── Terminal Progress Display ────────────────────────────────────────────────

/**
 * Manages a growing list of terminal lines where each line can be updated
 * in place via targeted ANSI cursor movement.
 *
 * Usage:
 *   const i = display.addLine("starting...");  // appends a new line, returns its index
 *   display.update(i, "page 5/100 ...");        // rewrites that specific line in place
 *   display.update(i, "✅ done");               // finalize — line stays, never changes again
 *
 * Completed lines remain visible and scroll up naturally as new lines are
 * added below them. Falls back to plain console.log when stdout is not a TTY
 * (e.g. piped output or CI logs).
 */
class ProgressDisplay {
  constructor() {
    this._lines = []; // text for every line ever added
    this._rendered = 0; // number of lines currently on screen
    this._tty = process.stdout.isTTY ?? false;
  }

  /**
   * Appends a new line at the bottom of the display and returns its index.
   * @param {string} text
   * @returns {number} line index for use with update()
   */
  addLine(text) {
    const i = this._lines.length;
    this._lines.push(text);
    if (this._tty) {
      process.stdout.write(`${text}\n`);
      this._rendered = this._lines.length;
    } else {
      console.log(text);
    }
    return i;
  }

  /**
   * Rewrites a previously added line in place.
   * @param {number} i    - Index returned by addLine()
   * @param {string} text - Replacement text (no newline)
   */
  update(i, text) {
    this._lines[i] = text;
    if (!this._tty) {
      console.log(text);
      return;
    }
    // How many lines above the current cursor position is line i?
    const up = this._rendered - i;
    process.stdout.write(`\x1b[${up}A`); // move cursor up to line i
    process.stdout.write(`\r\x1b[K${text}`); // clear and rewrite
    process.stdout.write(`\x1b[${up}B\r`); // move cursor back to bottom
  }
}

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
  if (!data.token)
    throw new Error(`Registration failed: ${JSON.stringify(data)}`);
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
  const s = Math.floor(secs % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Formats an elapsed millisecond count into a human-readable string.
 * e.g. 75000 → "1m 15s", 45000 → "45s"
 *
 * @param {number} ms
 * @returns {string}
 */
function fmtElapsed(ms) {
  const totalSecs = Math.round(ms / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Strips a timing point label down to a clean, CSV-friendly leg name.
 *   "Run/Finish"       → "Run"       (takes the part before "/")
 *   "Bike 56mi | 89km" → "Bike 56mi" (takes the part before "|")
 *   "FINISH" / "START" → ""           (caller supplies a positional fallback)
 *
 * @param {string} label
 * @returns {string}
 */
function cleanLabel(label) {
  // Strip everything after "/" or "|" (e.g. "Run/Finish" → "Run", "Bike 56mi|89km" → "Bike 56mi")
  let clean = (label || "").split("/")[0].split("|")[0].trim();
  // Strip a trailing " Finish" word for labels like "Bike Finish" → "Bike"
  clean = clean.replace(/\s+finish$/i, "").trim();
  // Pure start/finish labels produce an empty string; the caller supplies a positional fallback
  if (/^(finish|start)$/i.test(clean)) return "";
  return clean;
}

// ─── Split Cache Helpers ──────────────────────────────────────────────────────
//
// Each timing point's splits are stored as {eventId}_splits_{pointName}.json
// in the output directory. Files are written atomically (via a .tmp rename) so
// a partial write from a crashed run is never mistaken for a complete cache.

/**
 * Returns the canonical path for a point's split cache file.
 *
 * @param {string} outputDir
 * @param {string} eventId
 * @param {string} ptName
 * @returns {string}
 */
function splitFilePath(outputDir, eventId, ptName) {
  return path.join(outputDir, `${eventId}_splits_${ptName}.json`);
}

/**
 * Serializes a split Map to disk atomically: writes to a .tmp file first,
 * then renames to the final path. This ensures a crashed mid-write never
 * leaves a corrupt cache file that would be silently trusted on resume.
 *
 * @param {string}              outputDir
 * @param {string}              eventId
 * @param {string}              ptName
 * @param {Map<string, object>} map - bib → split record
 */
async function saveSplits(outputDir, eventId, ptName, map) {
  const tmp = splitFilePath(outputDir, eventId, ptName) + ".tmp";
  const final = splitFilePath(outputDir, eventId, ptName);
  const arr = [...map.entries()].map(([bib, rec]) => ({ bib, ...rec }));
  await fs.writeFile(tmp, JSON.stringify(arr));
  await fs.rename(tmp, final);
}

/**
 * Loads a split cache file from disk and returns it as a bib → record Map.
 *
 * @param {string} outputDir
 * @param {string} eventId
 * @param {string} ptName
 * @returns {Promise<Map<string, object>>}
 */
async function loadSplits(outputDir, eventId, ptName) {
  const raw = await fs.readFile(
    splitFilePath(outputDir, eventId, ptName),
    "utf8"
  );
  const arr = JSON.parse(raw);
  const map = new Map();
  for (const rec of arr) {
    const { bib, ...rest } = rec;
    map.set(String(bib), rest);
  }
  return map;
}

/**
 * Returns true if a complete (non-.tmp) split cache file exists for the point.
 *
 * @param {string} outputDir
 * @param {string} eventId
 * @param {string} ptName
 * @returns {Promise<boolean>}
 */
async function splitFileExists(outputDir, eventId, ptName) {
  try {
    await fs.access(splitFilePath(outputDir, eventId, ptName));
    return true;
  } catch {
    return false;
  }
}

// ─── RTRT Data Fetching ───────────────────────────────────────────────────────

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
    const data = await rtrtFetch(
      `/events/${eventId}/points?${qs}&start=${start}`
    );
    if (data.error || !data.list?.length) break;
    allPoints.push(...data.list);
    if (data.list.length < PAGE) break;
    start = parseInt(data.info?.last ?? start) + 1;
    await new Promise((r) => setTimeout(r, 100));
  }

  return allPoints.sort(
    (a, b) => parseFloat(a.km || 0) - parseFloat(b.km || 0)
  );
}

/**
 * Fetches every split record for a single timing point, paginating through
 * all pages.
 *
 * On network-level failures (ECONNRESET, ETIMEDOUT, etc.) or RTRT API errors,
 * retries up to 3 times with linear back-off (5s / 10s / 15s), refreshing the
 * session token before each retry.
 *
 * @param {string}              eventId
 * @param {string}              pointName   - Timing point name, e.g. "START" or "5K"
 * @param {string}              appid
 * @param {{value: string}}     tokenRef    - Mutable token holder; updated on retry
 * @param {number}              [hintTotal] - Expected total athletes (used to estimate page count)
 * @param {Function}            [onProgress]- Called with a status string on each page.
 *                                            Defaults to a no-op; pass a ProgressDisplay updater.
 * @returns {Promise<Map<string, object>>} Map of bib → split record
 */
async function fetchAllSplitsAtPoint(
  eventId,
  pointName,
  appid,
  tokenRef,
  hintTotal = 0,
  onProgress = () => {}
) {
  const map = new Map();
  let start = 1;
  let retries = 0;
  const estPages = hintTotal > 0 ? Math.ceil(hintTotal / PAGE) : 0;
  const pointStart = Date.now();

  const progress = (page, records) => {
    const elapsed = ((Date.now() - pointStart) / 1000).toFixed(0);
    const pageStr = estPages > 0 ? `page ${page}/${estPages}` : `page ${page}`;
    onProgress(`⏳ ${pageStr}  •  ${records} records  •  ${elapsed}s elapsed`);
  };

  while (true) {
    const qs = `appid=${appid}&token=${tokenRef.value}`;
    const url = `/events/${eventId}/points/${pointName}/splits?${qs}&start=${start}`;

    let data;
    try {
      data = await rtrtFetch(url);
    } catch (networkErr) {
      if (retries < 3) {
        retries++;
        const wait = retries * 5000;
        onProgress(
          `⚠️  network retry ${retries}/3 in ${wait / 1000}s — ${
            networkErr.message
          }`
        );
        await new Promise((r) => setTimeout(r, wait));
        tokenRef.value = await register(appid);
        continue;
      }
      throw networkErr;
    }

    if (data.error) {
      const type = data.error.type ?? "";
      const msg = data.error.msg ?? "";
      // Terminal errors — point has no data, treat as empty
      if (
        type === "no_results" ||
        type === "access_denied" ||
        msg.toLowerCase().includes("not found")
      ) {
        return map;
      }
      // Transient errors — retry with token refresh
      if (retries < 3) {
        retries++;
        const wait = retries * 5000;
        onProgress(`⚠️  API retry ${retries}/3 in ${wait / 1000}s`);
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
 * @param {object[]}                athletes
 * @param {string[]}                legNames
 * @param {Map<string, number>|null} rtrtStarts - bib → Unix epoch start time, or null
 * @returns {{ athletes: object[], hasWaveData: boolean }}
 */
function normalizeAthletes(athletes, legNames, rtrtStarts) {
  // Step 1: convert absolute epoch times to seconds-since-first-wave offsets
  if (rtrtStarts) {
    const epochs = athletes.map((a) => a.startEpoch).filter((e) => e != null);
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
    const mid = Math.floor(sorted.length / 2);
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
 * Bib is used as a secondary sort key so rankings are fully deterministic
 * regardless of the input order or JavaScript engine version — two athletes
 * with identical times always receive the same relative rank across runs.
 *
 * @param {object[]}                       athletes
 * @param {(a: object) => number|null}     getTime
 * @returns {Map<string, number>} bib → 1-based rank
 */
function buildRankMap(athletes, getTime) {
  const eligible = athletes.filter((a) => getTime(a) != null);
  const sorted = [...eligible].sort((a, b) => {
    const diff = getTime(a) - getTime(b);
    return diff !== 0 ? diff : String(a.bib).localeCompare(String(b.bib));
  });
  const map = new Map();
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
  /** Resets all values to zero, allowing the tree to be reused across legs. */
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
    getBefore:
      i === 0
        ? hasWaveData
          ? (a) => a.waveOffset
          : null
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
    const afterMap = buildRankMap(athletes, leg.getAfter);
    let eligible = athletes.filter((a) => afterMap.has(a.bib));
    const isGunStart = leg.name === legNames[0] && !hasWaveData;

    if (isGunStart) {
      // Everyone started at the same position — closed-form counts
      for (const x of eligible) {
        const xAfter = afterMap.get(x.bib);
        const legData = results.get(x.bib)[leg.name];
        legData.gained = eligible.length - xAfter;
        legData.lost = xAfter - 1;
      }
      continue;
    }

    const beforeMap = buildRankMap(athletes, leg.getBefore);
    eligible = eligible.filter((a) => beforeMap.has(a.bib));
    if (eligible.length === 0) continue;

    const n = eligible.length;
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
    for (const x of [...eligible].sort(
      (a, b) => afterMap.get(b.bib) - afterMap.get(a.bib)
    )) {
      const xBefore = localBefore.get(x.bib);
      results.get(x.bib)[leg.name].gained =
        xBefore > 1 ? tree.query(xBefore - 1) : 0;
      tree.update(xBefore);
    }

    // Pass B — lost (best-after-rank first)
    tree.reset();
    let inserted = 0;
    for (const x of [...eligible].sort(
      (a, b) => afterMap.get(a.bib) - afterMap.get(b.bib)
    )) {
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
    getBefore:
      i === 0
        ? hasWaveData
          ? (a) => a.waveOffset
          : null
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
    const afterMap = buildRankMap(athletes, leg.getAfter);
    const eligible = athletes.filter((a) => afterMap.has(a.bib));
    const isGunStart = leg.name === legNames[0] && !hasWaveData;

    let beforeMap;
    if (isGunStart) {
      beforeMap = new Map(eligible.map((a) => [a.bib, 1]));
    } else {
      beforeMap = buildRankMap(athletes, leg.getBefore);
      eligible.splice(
        0,
        eligible.length,
        ...eligible.filter((a) => beforeMap.has(a.bib))
      );
    }

    for (const x of eligible) {
      const xBefore = beforeMap.get(x.bib);
      const xAfter = afterMap.get(x.bib);
      const legData = results.get(x.bib)[leg.name];

      for (const y of eligible) {
        if (y.bib === x.bib) continue;
        const yBefore = beforeMap.get(y.bib);
        const yAfter = afterMap.get(y.bib);
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
function pad(str, len) {
  return String(str).padEnd(len, " ").slice(0, len);
}

/** Right-pads str to len characters (for aligned terminal columns). */
function rpad(str, len) {
  return String(str).padStart(len, " ").slice(-len);
}

/**
 * Prints a summary header and the per-leg invariant check to stdout.
 * The invariant asserts that sum(gained) === sum(lost) for each leg across all
 * athletes — a necessary condition for a correct passing algorithm.
 *
 * @param {object[]}             athletes
 * @param {Map<string, object>}  passingMap
 * @param {string[]}             legNames
 * @param {boolean}              hasWaveData
 * @param {number}               elapsedMs   - Total wall-clock time for the run
 */
function printReport(athletes, passingMap, legNames, hasWaveData, elapsedMs) {
  const finishers = athletes.filter(
    (a) => a.status === "FIN" && a.finishSecs != null
  );
  const dnfs = athletes.filter((a) => a.status === "DNF");
  const rtrtCount = athletes.filter((a) => a.startEpoch != null).length;

  const modeLabel =
    rtrtCount > 0
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
  console.log(`  Elapsed:   ${fmtElapsed(elapsedMs)}`);
  console.log("═".repeat(70));

  console.log(
    "\n📐 INVARIANT CHECK  (sum of gained must equal sum of lost per leg)"
  );
  console.log("─".repeat(50));

  let invariantOk = true;
  for (const leg of legNames) {
    let totalGained = 0;
    let totalLost = 0;
    for (const data of passingMap.values()) {
      totalGained += data[leg].gained;
      totalLost += data[leg].lost;
    }
    const ok = totalGained === totalLost;
    if (!ok) invariantOk = false;
    const icon = ok ? "✅" : "❌";
    console.log(
      `  ${icon}  ${pad(leg.toUpperCase(), 8)}  gained=${rpad(
        totalGained,
        7
      )}  lost=${rpad(totalLost, 7)}  ${ok ? "MATCH" : "MISMATCH ← BUG"}`
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
 * @param {object[]}             athletes
 * @param {Map<string, object>}  passingMap
 * @param {string[]}             legNames
 * @returns {string} CSV content (headers + rows, newline-separated)
 */
function buildOutputCSV(athletes, passingMap, legNames) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const headers = [
    "Bib",
    "Name",
    "Gender",
    "Country",
    "City",
    "Team",
    "Division",
    "Status",
    "Overall Rank",
    "Gender Rank",
    "Division Rank",
    "Overall Finish Time",
    "Wave Finish Time",
    ...legNames.map((l) => `${l} Time`),
    ...legNames.map((l) => `${l} EpochTime`),
    "Wave Offset (Seconds)",
    ...legNames.flatMap((l) => [`${l} Gained`, `${l} Lost`, `${l} Net`]),
    "Overall Net",
    "Overall Category Total",
    "Gender Category Total",
    "Division Category Total",
  ];

  const rows = athletes.map((a) => {
    const d = passingMap.get(a.bib);
    const overallNet = d
      ? legNames.reduce((sum, l) => sum + d[l].gained - d[l].lost, 0)
      : 0;

    const row = [
      a.bib,
      a.name,
      a.gender,
      a.country,
      a.city ?? "",
      a.team ?? "",
      a.division,
      a.status,
      a.overallRank ?? "",
      a.genderRank ?? "",
      a.divisionRank ?? "",
      fmtTimeLong(a.finishSecs),
      a.waveTime ?? "",
      ...legNames.map((l) => fmtTimeLong(a.legSecs[l])),
      ...legNames.map((l) => a.legEpochs?.[l] ?? ""),
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

    row.push(
      a.categoryTotals?.overall ?? "",
      a.categoryTotals?.gender ?? "",
      a.categoryTotals?.division ?? "",
    );

    return row.map(esc).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

// ─── Orchestration ────────────────────────────────────────────────────────────

/**
 * Resolves the ordered list of timing points for an event. If forcedPoints is
 * provided the API discovery call is skipped entirely. Otherwise, queries the
 * RTRT points endpoint, identifies START/FINISH, and includes all published
 * intermediate points (transitions included even when hide_in_badges is set).
 *
 * Returns an array of point descriptor objects:
 *   { name, label, legName, isStart, isFinish }
 *
 * @param {string}          eventId
 * @param {string}          appid
 * @param {string}          token
 * @param {string[]|null}   forcedPoints - Names from --points flag, or null
 * @returns {Promise<object[]>}
 */
async function discoverTimingPoints(eventId, appid, token, forcedPoints) {
  if (forcedPoints) {
    console.log(`\n📋 Using specified points: ${forcedPoints.join(", ")}`);
    return forcedPoints.map((name, i) => ({
      name,
      label: name,
      legName: name,
      isStart: i === 0,
      isFinish: i === forcedPoints.length - 1,
    }));
  }

  console.log("\n📋 Discovering timing points...");
  const allPoints = await fetchAllPoints(eventId, appid, token);
  console.log(`   Found ${allPoints.length} total timing points`);

  const startPoint = allPoints.find((p) => p.isStart === "1");
  const finishPoint = allPoints.find((p) => p.isFinish === "1");
  if (!startPoint) throw new Error("No START point found for this event");
  if (!finishPoint) throw new Error("No FINISH point found for this event");

  // Include transitions (T1, T2, etc.) even when hide_in_badges is set,
  // since they are meaningful legs for triathlon passing analysis.
  const isTransition = (p) => /^T\d+$/i.test(p.name) || /^T\d+$/i.test(p.label);
  const intermediate = allPoints.filter(
    (p) =>
      p.publish === "1" &&
      p.isStart !== "1" &&
      p.isFinish !== "1" &&
      (p.hide_in_badges !== "1" || isTransition(p))
  );

  console.log(
    `   START: ${startPoint.name} (${startPoint.label || startPoint.name})`
  );
  console.log(`   Intermediate: ${intermediate.length} points`);
  for (const p of intermediate) {
    console.log(`     • ${p.name} — "${p.label}" @ ${p.km} km`);
  }
  console.log(
    `   FINISH: ${finishPoint.name} (${finishPoint.label || finishPoint.name})`
  );

  const legPoints = [...intermediate, finishPoint];
  return [
    {
      name: startPoint.name,
      label: startPoint.label,
      legName: null,
      isStart: true,
      isFinish: false,
    },
    ...legPoints.map((p, i) => ({
      name: p.name,
      label: p.label,
      legName: cleanLabel(p.label || p.name) || (p.isFinish === "1" ? "Finish" : `Leg ${i + 1}`),
      isStart: false,
      isFinish: p.isFinish === "1",
    })),
  ];
}

/**
 * Fetches splits for all timing points that don't have a cache file, writing
 * each to disk atomically as it completes. Points with existing cache files are
 * skipped (unless fresh=true).
 *
 * Up to `concurrency` points are fetched simultaneously, each with its own
 * registered session token to avoid concurrent token-refresh races.
 *
 * @param {string}   eventId
 * @param {object[]} pointsToFetch  - Point descriptors from discoverTimingPoints
 * @param {string}   appid
 * @param {string}   outputDir
 * @param {number}   hintTotal      - Expected finisher count (for progress estimates)
 * @param {object}   opts
 * @param {number}   opts.concurrency
 * @param {boolean}  opts.fresh     - If true, ignore existing cache files
 */
async function fetchAndCacheSplits(
  eventId,
  pointsToFetch,
  appid,
  outputDir,
  hintTotal,
  { concurrency, fresh }
) {
  const fetchStart = Date.now();
  let completed = 0;

  // Separate already-cached points from those still needing a fetch
  const toFetch = [];
  for (let i = 0; i < pointsToFetch.length; i++) {
    const pt = pointsToFetch[i];
    const cached =
      !fresh && (await splitFileExists(outputDir, eventId, pt.name));
    if (cached) {
      console.log(
        `   [${i + 1}/${pointsToFetch.length}] ${pt.name} — cached ✓`
      );
    } else {
      toFetch.push({ pt, idx: i });
    }
  }

  if (toFetch.length === 0) {
    console.log("\n   All points cached — skipping fetch.");
    return;
  }

  console.log(
    `\n   Fetching ${toFetch.length} point(s) with concurrency=${concurrency}...\n`
  );

  // Register one session token per worker to avoid concurrent refresh races
  const workerCount = Math.min(concurrency, toFetch.length);
  const tokens = await Promise.all(
    Array.from({ length: workerCount }, () => register(appid))
  );
  const tokenRefs = tokens.map((value) => ({ value }));
  const queue = [...toFetch];
  const display = new ProgressDisplay();

  /**
   * Worker loop: pulls jobs from the shared queue until empty.
   * Each job fetches one timing point and writes it to disk.
   *
   * @param {{value: string}} workerToken - This worker's mutable token holder
   */
  async function runWorker(workerToken) {
    while (queue.length > 0) {
      const { pt, idx } = queue.shift();
      const label = `   [${idx + 1}/${pointsToFetch.length}] ${pt.name.padEnd(
        8
      )}`;
      const ptStart = Date.now();

      // Each point gets its own persistent line in the terminal display
      const lineIdx = display.addLine(`${label} starting...`);

      const map = await fetchAllSplitsAtPoint(
        eventId,
        pt.name,
        appid,
        workerToken,
        hintTotal,
        (status) => display.update(lineIdx, `${label} ${status}`)
      );
      await saveSplits(outputDir, eventId, pt.name, map);

      completed++;
      const ptSecs = ((Date.now() - ptStart) / 1000).toFixed(1);
      const elapsed = ((Date.now() - fetchStart) / 1000).toFixed(0);
      const left = toFetch.length - completed;
      const avgSecs = (Date.now() - fetchStart) / 1000 / completed;
      const etaSecs = Math.round(left * avgSecs);
      const eta =
        etaSecs > 60 ? `~${Math.round(etaSecs / 60)}m` : `~${etaSecs}s`;
      display.update(
        lineIdx,
        `${label} ✅ ${
          map.size
        } records in ${ptSecs}s  •  ${elapsed}s total  •  ${
          left > 0 ? eta + " remaining" : "all done"
        }`
      );
    }
  }

  await Promise.all(tokenRefs.map((tr) => runWorker(tr)));
}

/**
 * Loads all cached split files and constructs the athlete records array.
 *
 * All intermediate split maps are preloaded into memory before the athlete loop
 * to avoid per-bib async overhead (54k awaits on a getSplits call that is
 * effectively synchronous after the first load is expensive in practice).
 *
 * Returns the athletes array (sorted by overall rank) and a map of bib →
 * Unix epoch start time for athletes whose START split contained timing data.
 *
 * @param {string}   eventId
 * @param {object[]} pointsToFetch - Point descriptors from discoverTimingPoints
 * @param {string}   outputDir
 * @returns {Promise<{ athletes: object[], rtrtStarts: Map<string, number> }>}
 */
async function buildAthleteRecords(eventId, pointsToFetch, outputDir) {
  const startPointName = pointsToFetch.find((p) => p.isStart)?.name;
  const legPointDefs = pointsToFetch.filter((p) => !p.isStart);

  // Preload all split files upfront — avoids 54k individual awaits in the loop
  console.log("\n   Loading split files...");
  const allSplits = new Map();
  for (const pt of pointsToFetch) {
    allSplits.set(pt.name, await loadSplits(outputDir, eventId, pt.name));
  }

  const startSplits = allSplits.get(startPointName);
  const finishPtDef = legPointDefs.find((p) => p.isFinish);
  const finishSplits = allSplits.get(finishPtDef?.name);

  const allBibs = new Set([...startSplits.keys(), ...finishSplits.keys()]);
  console.log(`   Total athletes found: ${allBibs.size}`);

  const athletes = [];
  const rtrtStarts = new Map();

  for (const bib of allBibs) {
    const startSplit = startSplits.get(bib);
    const finishSplit = finishSplits.get(bib);
    const profile = finishSplit ?? startSplit;
    if (!profile) continue;

    // Compute leg split times as differences between consecutive cumulative chip times
    const legSecs = {};
    let prevCumSecs = 0;
    for (const legPt of legPointDefs) {
      const split = allSplits.get(legPt.name)?.get(bib);
      const cumSecs = parseTime(split?.netTime);
      if (cumSecs != null && prevCumSecs !== null) {
        legSecs[legPt.legName] = Math.max(0, Math.round(cumSecs - prevCumSecs));
        prevCumSecs = cumSecs;
      } else {
        legSecs[legPt.legName] = null;
        prevCumSecs = null;
      }
    }

    const finishCumSecs = parseTime(finishSplit?.netTime);
    const results = finishSplit?.results ?? {};
    const overallRank = results["course"]?.p ?? results["overall"]?.p ?? null;
    const genderRank = results["course-sex"]?.p ?? results["gender"]?.p ?? null;
    const divisionRank =
      results["course-sex-division"]?.p ?? results["agegroup"]?.p ?? null;
    const gender =
      profile.sex === "M" ? "Male" : profile.sex === "F" ? "Female" : "";
    const startEpoch = startSplit?.epochTime
      ? parseFloat(startSplit.epochTime)
      : null;

    if (startEpoch != null) rtrtStarts.set(bib, startEpoch);

    // Per-leg epoch times (wall-clock Unix timestamp of each mat crossing)
    const legEpochs = {};
    for (const legPt of legPointDefs) {
      const split = allSplits.get(legPt.name)?.get(bib);
      legEpochs[legPt.legName] = split?.epochTime ? parseFloat(split.epochTime) : null;
    }

    // Category totals from the finish split results (total finishers per category)
    const categoryTotals = {
      overall: results["course"]?.t != null ? parseInt(results["course"].t, 10) : null,
      gender:  results["course-sex"]?.t != null ? parseInt(results["course-sex"].t, 10) : null,
      division: results["course-sex-division"]?.t != null ? parseInt(results["course-sex-division"].t, 10) : null,
    };

    athletes.push({
      bib,
      name: profile.name ?? "",
      gender,
      country: profile.country_iso?.toUpperCase() ?? profile.country ?? "",
      city: profile.city ?? "",
      team: profile.team ?? "",
      division: profile.division ?? "",
      status: finishSplit ? "FIN" : "DNF",
      overallRank: overallRank != null ? parseInt(overallRank, 10) : null,
      genderRank: genderRank != null ? parseInt(genderRank, 10) : null,
      divisionRank: divisionRank != null ? parseInt(divisionRank, 10) : null,
      finishSecs: finishCumSecs ?? null,
      waveTime: finishSplit?.waveTime ?? null,
      legSecs,
      legEpochs,
      categoryTotals,
      startEpoch,
      waveOffset: null,
      cumPositions: {},
    });
  }

  // If RTRT didn't supply any rank data (common for road races), compute ranks
  // ourselves from finish times. Ranks are assigned to finishers only; DNFs are
  // left null. Ties are broken by bib for determinism (matches buildRankMap).
  const hasRtrtRanks = athletes.some((a) => a.overallRank != null);
  if (!hasRtrtRanks) {
    console.log("   No RTRT rank data found — computing ranks from finish times.");
    const finishers = athletes
      .filter((a) => a.status === "FIN" && a.finishSecs != null)
      .sort((a, b) => a.finishSecs - b.finishSecs || String(a.bib).localeCompare(String(b.bib)));

    // Overall rank
    finishers.forEach((a, i) => { a.overallRank = i + 1; });

    // Gender rank — group by gender, preserving overall-rank order within each group
    const byGender = new Map();
    for (const a of finishers) {
      if (!byGender.has(a.gender)) byGender.set(a.gender, []);
      byGender.get(a.gender).push(a);
    }
    for (const group of byGender.values()) {
      group.forEach((a, i) => { a.genderRank = i + 1; });
    }

    // Division rank — group by division, preserving overall-rank order within each group
    const byDivision = new Map();
    for (const a of finishers) {
      const key = a.division || "__none__";
      if (!byDivision.has(key)) byDivision.set(key, []);
      byDivision.get(key).push(a);
    }
    for (const [key, group] of byDivision.entries()) {
      // Skip the catch-all bucket — athletes with no division don't get a division rank
      if (key === "__none__") continue;
      group.forEach((a, i) => { a.divisionRank = i + 1; });
    }
  }

  athletes.sort((a, b) => (a.overallRank ?? 99999) - (b.overallRank ?? 99999));

  const finisherCount = athletes.filter((a) => a.status === "FIN").length;
  const dnfCount = athletes.filter((a) => a.status === "DNF").length;
  console.log(`   Finishers: ${finisherCount} | DNFs: ${dnfCount}`);

  return { athletes, rtrtStarts };
}

/**
 * Normalizes athletes, runs the fast passing algorithm, and optionally verifies
 * results against the O(n²) reference implementation.
 *
 * @param {object[]}             athletes
 * @param {string[]}             legNames
 * @param {Map<string, number>}  rtrtStarts  - bib → epoch; pass empty Map if unavailable
 * @param {boolean}              verifyMode  - Whether to run --verify diff
 * @returns {{ normalizedAthletes: object[], passingMap: Map, hasWaveData: boolean }}
 */
function runPassingAnalysis(athletes, legNames, rtrtStarts, verifyMode) {
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

  const passingMap = computePassingDataFast(
    normalizedAthletes,
    legNames,
    hasWaveData
  );

  // Optional: diff fast algorithm against O(n²) reference to verify correctness
  if (verifyMode) {
    console.log(
      "\n🔍 --verify: running O(n²) reference algorithm to diff results..."
    );
    const refMap = computePassingData(
      normalizedAthletes,
      legNames,
      hasWaveData
    );
    let mismatches = 0;

    for (const a of normalizedAthletes) {
      const fast = passingMap.get(a.bib);
      const ref = refMap.get(a.bib);
      if (!fast || !ref) continue;
      for (const leg of legNames) {
        if (
          fast[leg].gained !== ref[leg].gained ||
          fast[leg].lost !== ref[leg].lost
        ) {
          if (mismatches === 0)
            console.log(
              "   BIB       LEG      FAST gained/lost  REF gained/lost"
            );
          console.log(
            `   ${String(a.bib).padEnd(9)} ${leg.padEnd(8)} ` +
              `fast=${fast[leg].gained}/${fast[leg].lost}  ref=${ref[leg].gained}/${ref[leg].lost}`
          );
          if (++mismatches >= 20) {
            console.log("   ... (truncated at 20 mismatches)");
            break;
          }
        }
      }
      if (mismatches >= 20) break;
    }

    if (mismatches === 0) {
      console.log(
        "   ✅ PASS — fast and reference algorithms produce identical results."
      );
    } else {
      console.log(
        `\n   ❌ FAIL — ${mismatches} mismatch(es) found. Results written using fast algorithm.`
      );
    }
  }

  return { normalizedAthletes, passingMap, hasWaveData };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const eventId = args.find((a) => !a.startsWith("--"));
const appidIdx = args.indexOf("--appid");
const appid = appidIdx !== -1 ? args[appidIdx + 1] : null;
const outdirIdx = args.indexOf("--output-dir");
const outputDir =
  outdirIdx !== -1 ? args[outdirIdx + 1] : path.join(__dirname, "data");
const pointsIdx = args.indexOf("--points");
const forcedPoints =
  pointsIdx !== -1
    ? args[pointsIdx + 1]?.split(",").map((p) => p.trim())
    : null;
const concurrencyIdx = args.indexOf("--concurrency");
const concurrency =
  concurrencyIdx !== -1
    ? parseInt(args[concurrencyIdx + 1], 10)
    : DEFAULT_CONCURRENCY;
const freshMode = args.includes("--fresh");
const verifyMode = args.includes("--verify");

if (!eventId || !appid) {
  if (eventId && !appid) {
    console.error(`Error: --appid is required.\n`);
  }
  console.error(`\
Usage: node scraper/racereplay.mjs <event-id> --appid <id> [options]

  event-id              RTRT event ID, e.g. IRM-OCEANSIDE703-2026

Options:
  --appid <id>          RTRT app ID for this event's tracker app. Required.
                        Find it at track.rtrt.me/e/<event-id> (view page
                        source, search for "appid").
  --output-dir <dir>    Directory to write output files (default: scraper/data/)
  --points <list>       Comma-separated timing point names to use, in order.
                        Overrides auto-discovery.
                        Example: --points START,SWIM,T1,BIKE,T2,FINISH
  --concurrency <n>     Points to fetch in parallel (default: ${DEFAULT_CONCURRENCY}).
  --fresh               Ignore cached split files and re-fetch everything.
  --verify              Run the O(n²) reference algorithm after the fast algorithm
                        and diff the results to confirm correctness.

Examples:
  node scraper/racereplay.mjs <event-id> --appid <id>
  node scraper/racereplay.mjs <event-id> --appid <id> --points START,SWIM,T1,BIKE,T2,FINISH
  node scraper/racereplay.mjs <event-id> --appid <id> --fresh
`);
  process.exit(1);
}

(async () => {
  const runStart = Date.now();

  try {
    await fs.mkdir(outputDir, { recursive: true });

    // ── Connect and load event metadata ──────────────────────────────────────
    console.log("🔑 Registering with RTRT.me...");
    const tokenRef = { value: await register(appid) };

    const event = await rtrtFetch(
      `/events/${eventId}?appid=${appid}&token=${tokenRef.value}`
    );
    if (event.error) throw new Error(`Event not found: ${event.error.msg}`);
    console.log(`\n📍 Event: ${event.desc} (${event.date})`);
    console.log(`   Location: ${event.loc?.desc ?? "unknown"}`);
    console.log(`   Finishers reported: ${event.finishers ?? "unknown"}`);

    // ── Resolve timing points ─────────────────────────────────────────────────
    const pointsToFetch = await discoverTimingPoints(
      eventId,
      appid,
      tokenRef.value,
      forcedPoints
    );
    const legPointDefs = pointsToFetch.filter((p) => !p.isStart);
    const legNames = legPointDefs.map((p) => p.legName);

    console.log(`\n   Legs to compute: ${legNames.join(" → ")}`);

    // ── Fetch and cache splits ────────────────────────────────────────────────
    const hintTotal = event.finishers ? parseInt(event.finishers, 10) : 0;
    await fetchAndCacheSplits(
      eventId,
      pointsToFetch,
      appid,
      outputDir,
      hintTotal,
      {
        concurrency,
        fresh: freshMode,
      }
    );

    // ── Build athlete records ─────────────────────────────────────────────────
    const { athletes, rtrtStarts } = await buildAthleteRecords(
      eventId,
      pointsToFetch,
      outputDir
    );

    // ── Run passing analysis ──────────────────────────────────────────────────
    console.log("\n⚙️  Running passing analysis...");
    const { normalizedAthletes, passingMap, hasWaveData } = runPassingAnalysis(
      athletes,
      legNames,
      rtrtStarts,
      verifyMode
    );

    // ── Print report and write CSV ────────────────────────────────────────────
    printReport(
      normalizedAthletes,
      passingMap,
      legNames,
      hasWaveData,
      Date.now() - runStart
    );

    const outputFile = path.join(outputDir, `${eventId}_passing.csv`);
    await fs.writeFile(
      outputFile,
      buildOutputCSV(normalizedAthletes, passingMap, legNames)
    );
    console.log(`📄 Passing data written to: ${outputFile}`);

    console.log(`
Next step:
  cd app
  npx tsx scripts/ingest.ts ../${path.relative(
    path.join(__dirname, ".."),
    outputFile
  )} \\
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
