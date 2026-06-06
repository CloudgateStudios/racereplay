#!/usr/bin/env node
/**
 * racereplay.mjs
 *
 * Fetch race data from RTRT.me and run the leg-by-leg physical passing
 * algorithm in a single step. Pass in the RTRT event ID and get back a
 * _passing.csv ready for ingestion.
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
 *
 * Examples:
 *   # Shamrock Shuffle 2026 (Bank of America — uses a different app ID)
 *   node scripts/racereplay.mjs BASS2026 --appid 4d9df5bf9f36bc4a1dc8fce2
 *
 *   # Any IRONMAN event (uses default IRONMAN app ID)
 *   node scripts/racereplay.mjs IRM-OCEANSIDE703-2026
 *
 * Note on large races: fetching splits for a 24,000-athlete event takes ~18 minutes
 * (3 points × 1,200 pages × 300ms/page + pauses between points). This is a one-time
 * cost — results are written to disk and served from your own database thereafter.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IRONMAN_APPID = "5824c5c948fd08c23a8b4567";
const API         = "https://api.rtrt.me";
const UA          = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const PAGE        = 20;
const DELAY       = 300;  // ms between pages within a point
const POINT_DELAY = 5000; // ms between fetching different timing points

// ─── Fetch Helpers ────────────────────────────────────────────────────────────

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

/** Format seconds → "H:MM:SS" or "M:SS" */
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
 * "Bike 56mi | 89km" → "Bike 56mi"
 * "FINISH" / "START" → "" (caller provides a positional fallback)
 */
function cleanLabel(label) {
  const clean = (label || "")
    .split("/")[0]
    .split("|")[0]
    .trim();
  if (/^(finish|start)$/i.test(clean)) return "";
  return clean;
}

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

async function fetchAllSplitsAtPoint(eventId, pointName, appid, tokenRef) {
  const map = new Map();
  let start = 1;
  let retries = 0;

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
        process.stdout.write(` [network retry ${retries} in ${wait / 1000}s: ${networkErr.message}]`);
        await new Promise((r) => setTimeout(r, wait));
        tokenRef.value = await register(appid);
        continue;
      }
      throw networkErr;
    }

    if (data.error) {
      const type = data.error.type ?? "";
      const msg  = data.error.msg ?? "";
      if (type === "no_results" || type === "access_denied" || msg.toLowerCase().includes("not found")) {
        return map;
      }
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

// ─── Analysis Helpers ─────────────────────────────────────────────────────────

function normalizeAthletes(athletes, legNames, rtrtStarts) {
  if (rtrtStarts) {
    const epochs = athletes.map((a) => a.startEpoch).filter((e) => e != null);
    const minEpoch = epochs.length ? Math.min(...epochs) : 0;
    for (const a of athletes) {
      if (a.startEpoch != null) {
        a.waveOffset = Math.round((a.startEpoch - minEpoch) * 1000) / 1000;
      }
    }
  }

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

function buildRankMap(athletes, getTime) {
  const eligible = athletes.filter((a) => getTime(a) != null);
  const sorted = [...eligible].sort((a, b) => getTime(a) - getTime(b));
  const map = new Map();
  sorted.forEach((a, i) => map.set(a.bib, i + 1));
  return map;
}

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

    let beforeMap;
    const isGunStart = leg.name === legNames[0] && !hasWaveData;

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

function pad(str, len)  { return String(str).padEnd(len, " ").slice(0, len); }
function rpad(str, len) { return String(str).padStart(len, " ").slice(-len); }

function fmtTimeLong(secs) {
  if (secs == null) return "--:--:--";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function printReport(athletes, passingMap, legNames, hasWaveData) {
  const finishers = athletes.filter((a) => a.status === "FIN" && a.finishSecs != null);
  const dnfs      = athletes.filter((a) => a.status === "DNF");

  console.log("\n" + "═".repeat(70));
  console.log("  RACEREPLAY — Passing Analysis");
  console.log("═".repeat(70));
  console.log(`  Athletes:  ${athletes.length}`);
  console.log(`  Finishers: ${finishers.length}`);
  console.log(`  DNFs:      ${dnfs.length}`);
  console.log(`  Legs:      ${legNames.join(", ")}`);

  const rtrtCount = athletes.filter((a) => a.startEpoch != null).length;
  const modeLabel =
    rtrtCount > 0
      ? `✅ Physical passing — RTRT start times (${rtrtCount} athletes matched)`
      : hasWaveData
        ? "✅ Physical passing — wave offsets applied"
        : "⚠️  Chip time only — no start time data";
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
    const ok = totalGained === totalLost;
    if (!ok) invariantOk = false;
    const icon = ok ? "✅" : "❌";
    console.log(
      `  ${icon}  ${pad(leg.toUpperCase(), 8)}  gained=${rpad(totalGained, 7)}  lost=${rpad(totalLost, 7)}  ${ok ? "MATCH" : "MISMATCH ← BUG"}`
    );
  }
  console.log(`\n  Overall invariant: ${invariantOk ? "✅ PASS" : "❌ FAIL"}`);

  const sorted = finishers
    .filter((a) => a.overallRank != null)
    .sort((a, b) => a.overallRank - b.overallRank);

  console.log("\n\n🏆 TOP 5 FINISHERS — Leg-by-leg passing breakdown");
  console.log("─".repeat(70));
  console.log(`  ${"Rank".padEnd(5)} ${"Name".padEnd(28)} ${"Div".padEnd(8)} ${"Finish".padEnd(9)} Net`);
  console.log("─".repeat(70));

  for (const a of sorted.slice(0, 5)) {
    const d   = passingMap.get(a.bib);
    if (!d) continue;
    const net = legNames.reduce((sum, l) => sum + d[l].gained - d[l].lost, 0);
    console.log(
      `  ${rpad(a.overallRank, 4)}  ${pad(a.name, 28)} ${pad(a.division, 8)} ${fmtTimeLong(a.finishSecs).padEnd(9)} ${net >= 0 ? "+" : ""}${net}`
    );
    for (const leg of legNames) {
      const { gained, lost } = d[leg];
      const legNet = gained - lost;
      console.log(`         ${pad(leg, 8)}  +${rpad(gained, 3)} / -${rpad(lost, 3)}  net ${legNet >= 0 ? "+" : ""}${legNet}`);
    }
    console.log();
  }

  const withNet = finishers
    .map((a) => {
      const d = passingMap.get(a.bib);
      if (!d) return null;
      const net = legNames.reduce((sum, l) => sum + d[l].gained - d[l].lost, 0);
      return { ...a, net };
    })
    .filter(Boolean)
    .sort((a, b) => b.net - a.net);

  console.log("\n🚀 BIGGEST CLIMBERS (most net positions gained)");
  console.log("─".repeat(70));
  for (const a of withNet.slice(0, 10)) {
    const d      = passingMap.get(a.bib);
    const perLeg = legNames.map((l) => `${l}:${d[l].gained - d[l].lost >= 0 ? "+" : ""}${d[l].gained - d[l].lost}`).join("  ");
    console.log(
      `  ${rpad(a.overallRank, 4)}  ${pad(a.name, 28)} ${pad(a.division, 8)} ${fmtTimeLong(a.finishSecs).padEnd(9)} +${a.net}`
    );
    console.log(`         ${perLeg}`);
  }

  console.log("\n📉 BIGGEST FALLERS (most net positions lost)");
  console.log("─".repeat(70));
  for (const a of withNet.slice(-10).reverse()) {
    const d      = passingMap.get(a.bib);
    const perLeg = legNames.map((l) => `${l}:${d[l].gained - d[l].lost >= 0 ? "+" : ""}${d[l].gained - d[l].lost}`).join("  ");
    console.log(
      `  ${rpad(a.overallRank, 4)}  ${pad(a.name, 28)} ${pad(a.division, 8)} ${fmtTimeLong(a.finishSecs).padEnd(9)} ${a.net}`
    );
    console.log(`         ${perLeg}`);
  }

  console.log("\n" + "═".repeat(70) + "\n");
}

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

    const startPointName = pointsToFetch.find((p) => p.isStart)?.name;
    const legPointDefs   = pointsToFetch.filter((p) => !p.isStart);
    const legNames       = legPointDefs.map((p) => p.legName);

    console.log(`\n   Legs to compute: ${legNames.join(" → ")}`);

    // ── Fetch splits ──────────────────────────────────────────────────────────
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
    const finishPtDef  = legPointDefs.find((p) => p.isFinish);
    const finishSplits = splits[finishPtDef?.name] ?? new Map();

    const allBibs = new Set([...startSplits.keys(), ...finishSplits.keys()]);
    console.log(`\n   Total athletes found: ${allBibs.size}`);

    const athletes = [];
    const rtrtStarts = new Map();

    for (const bib of allBibs) {
      const startSplit  = startSplits.get(bib);
      const finishSplit = finishSplits.get(bib);
      const profile     = finishSplit ?? startSplit;
      if (!profile) continue;

      const status = finishSplit ? "FIN" : "DNF";

      const legSecs = {};
      let prevCumSecs = 0;

      for (const legPt of legPointDefs) {
        const split   = splits[legPt.name]?.get(bib);
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
      const results       = finishSplit?.results ?? {};
      const overallRank   = results["course"]?.p    ?? results["overall"]?.p  ?? null;
      const genderRank    = results["course-sex"]?.p ?? results["gender"]?.p  ?? null;
      const divisionRank  = results["course-sex-division"]?.p ?? results["agegroup"]?.p ?? null;
      const gender        = profile.sex === "M" ? "Male" : profile.sex === "F" ? "Female" : "";
      const startEpoch    = startSplit?.epochTime ? parseFloat(startSplit.epochTime) : null;

      if (startEpoch != null) rtrtStarts.set(bib, startEpoch);

      athletes.push({
        bib,
        name:         profile.name ?? "",
        gender,
        country:      profile.country_iso?.toUpperCase() ?? profile.country ?? "",
        division:     profile.division ?? "",
        status,
        overallRank:  overallRank  != null ? parseInt(overallRank, 10)  : null,
        genderRank:   genderRank   != null ? parseInt(genderRank, 10)   : null,
        divisionRank: divisionRank != null ? parseInt(divisionRank, 10) : null,
        finishSecs:   finishCumSecs ?? null,
        legSecs,
        startEpoch,
        waveOffset:   null,
        cumPositions: {},
      });
    }

    athletes.sort((a, b) => {
      const ra = a.overallRank ?? 99999;
      const rb = b.overallRank ?? 99999;
      return ra - rb;
    });

    const finishers = athletes.filter((a) => a.status === "FIN").length;
    const dnfs      = athletes.filter((a) => a.status === "DNF").length;
    console.log(`   Finishers: ${finishers} | DNFs: ${dnfs}`);

    // ── Run passing analysis ──────────────────────────────────────────────────
    console.log("\n⚙️  Running passing analysis...");

    const hasRtrt    = rtrtStarts.size > 0;
    const { athletes: normalizedAthletes, hasWaveData } = normalizeAthletes(
      athletes,
      legNames,
      hasRtrt ? rtrtStarts : null
    );

    const modeMsg = hasRtrt
      ? `RTRT start times matched to ${rtrtStarts.size}/${athletes.length} athletes — physical passing mode active.`
      : "No per-athlete start times — using chip time comparisons only.";
    console.log(`   ${modeMsg}`);

    const passingMap = computePassingData(normalizedAthletes, legNames, hasWaveData);

    printReport(normalizedAthletes, passingMap, legNames, hasWaveData);

    // ── Write output ──────────────────────────────────────────────────────────
    const outputFile = path.join(outputDir, `${eventId}_passing.csv`);
    const outputCSV  = buildOutputCSV(normalizedAthletes, passingMap, legNames);
    await fs.writeFile(outputFile, outputCSV);
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
