#!/usr/bin/env node
/**
 * analyze-passing.mjs
 *
 * Reads a race results CSV (from fetch-rtrt-race.mjs, fetch-rtrt-event.mjs, or
 * fetch-race.mjs), runs the leg-by-leg passing analysis algorithm, prints a
 * verification report to stdout, and writes a full per-athlete passing CSV
 * alongside the input file.
 *
 * Works with any race format — the legs are auto-detected from CSV column headers.
 * Any column matching "* (Seconds)" (other than "Finish (Seconds)") is treated
 * as a timed leg, in the order they appear in the CSV.
 *
 * Triathlon CSV (from fetch-rtrt-race.mjs / fetch-race.mjs):
 *   Legs detected: Swim, T1, Bike, T2, Run
 *
 * Road race CSV (from fetch-rtrt-event.mjs for e.g. Shamrock Shuffle):
 *   Legs detected: 5K, Run
 *
 * Usage:
 *   node scripts/analyze-passing.mjs <csv-file> [options]
 *
 * Options:
 *   --rtrt-starts <file>   Per-athlete start epoch times (from fetch-rtrt-starts.mjs
 *                          or fetch-rtrt-event.mjs / fetch-rtrt-race.mjs _starts.csv).
 *                          Enables true physical passing for TT or wave-start races.
 *   --wave-offsets <file>  Per-division wave offsets in seconds (JSON).
 *                          Fallback for wave-start races without RTRT data.
 *                          See scripts/data/wave-offsets-example.json for format.
 *   --max-bibs <n>         Maximum number of bibs to store per athlete per leg.
 *                          Useful for large races (10,000+ athletes) where full
 *                          bib lists are impractical. Default: unlimited.
 *
 * Examples:
 *   # Triathlon with RTRT start times (recommended)
 *   node scripts/analyze-passing.mjs scripts/data/IRM-OCEANSIDE703-2026.csv \
 *     --rtrt-starts scripts/data/irm-oceanside703-2026_starts.csv
 *
 *   # Road race with RTRT start times
 *   node scripts/analyze-passing.mjs scripts/data/BASS2026.csv \
 *     --rtrt-starts scripts/data/bass2026_starts.csv
 *
 *   # Large road race — limit bib lists for performance
 *   node scripts/analyze-passing.mjs scripts/data/BASS2026.csv \
 *     --rtrt-starts scripts/data/bass2026_starts.csv \
 *     --max-bibs 50
 *
 *   # Chip time only
 *   node scripts/analyze-passing.mjs scripts/data/race.csv
 */

import fs from "fs/promises";
import path from "path";

// ─── CSV Parser ───────────────────────────────────────────────────────────────

function parseCSV(raw) {
  const lines = raw.trim().split("\n");
  const headers = parseCSVRow(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCSVRow(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
}

function parseCSVRow(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
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

// ─── Leg Detection ────────────────────────────────────────────────────────────

/**
 * Detect leg names from CSV headers, in column order.
 * Any column ending in "(Seconds)" is a leg, EXCEPT:
 *   "Finish (Seconds)"      — total elapsed, not a leg
 *   "Finish Gun (Seconds)"  — gun-time total
 *   "Wave Offset (Seconds)" — start offset, not a leg
 *
 * For a triathlon CSV this returns:  ["Swim", "T1", "Bike", "T2", "Run"]
 * For a road race CSV this returns:  ["5K", "Run"]  (or whatever the legs are)
 */
function detectLegs(sampleRow) {
  const SKIP = new Set([
    "Finish (Seconds)",
    "Finish Gun (Seconds)",
    "Wave Offset (Seconds)",
  ]);
  return Object.keys(sampleRow)
    .filter((k) => k.endsWith("(Seconds)") && !SKIP.has(k))
    .map((k) => k.replace(/ \(Seconds\)$/, ""));
}

// ─── Data Normalisation ───────────────────────────────────────────────────────

/**
 * normaliseAthletes(rows, legNames, rtrtStarts?, externalWaveOffsets?)
 *
 * Parses every athlete row and produces a normalised athlete object with:
 *   - legSecs: { [legName]: seconds }  — time for each individual leg
 *   - waveOffset: seconds after the first athlete started (from RTRT, wave file,
 *     or gun-time field in priority order)
 *   - cumPositions: { [legName]: waveOffset + cumulativeChipSeconds }
 *     — physical position at the END of each leg; the core input to passing calc
 *
 * Returns { athletes, hasWaveData }.
 *
 * rtrtStarts: Map<bib, startEpochSeconds> — precise per-athlete Unix epoch
 *   timestamps from RTRT.me.
 *   Gun-time cumulative at any checkpoint:
 *     gunCum[point] = (startEpoch - minStartEpoch) + chipSplitSeconds
 *   Subtracting minStartEpoch keeps values small and relative (no large floats).
 *
 * externalWaveOffsets: Map<division, offsetSeconds> — fallback for wave-start
 *   races without RTRT data. Loaded from --wave-offsets JSON.
 */
function normaliseAthletes(rows, legNames, rtrtStarts = null, externalWaveOffsets = null) {
  // First pass: parse raw fields
  const athletes = rows.map((r) => {
    const secs = (col) => {
      const v = parseInt(r[col], 10);
      return isNaN(v) || v <= 0 ? null : v;
    };

    // Parse seconds for each detected leg
    const legSecs = {};
    for (const leg of legNames) {
      legSecs[leg] = secs(`${leg} (Seconds)`);
    }

    const finish    = secs("Finish (Seconds)");
    const gunFinish = secs("Finish Gun (Seconds)");
    const bib       = r["Bib Number"] || "?";
    const division  = r["Division"] || "";

    // Per-athlete start epoch from RTRT (if available)
    const startEpoch = rtrtStarts?.get(String(bib)) ?? null;

    // waveOffset: sources in priority order:
    //   1. Derived from RTRT startEpoch (second pass, after all epochs are known)
    //   2. External wave-offsets file (keyed by division)
    //   3. Derived from API gun time: gunFinish - chipFinish
    //   4. Division peers' median (third pass — for athletes missing RTRT record)
    //   5. 0 (chip time only)
    let waveOffset = null;
    if (!rtrtStarts) {
      if (externalWaveOffsets && externalWaveOffsets.has(division)) {
        waveOffset = externalWaveOffsets.get(division);
      } else if (gunFinish != null && finish != null) {
        waveOffset = gunFinish - finish;
      }
    }

    return {
      bib,
      name:         r["Athlete Name"] || "Unknown",
      division,
      gender:       r["Gender"] || "",
      country:      r["Country"] || "",
      status:       r["Status"] || "FIN",
      overallRank:  parseInt(r["Overall Rank"], 10) || null,
      genderRank:   parseInt(r["Gender Rank"], 10) || null,
      divisionRank: parseInt(r["Division Rank"], 10) || null,
      legSecs,
      finishSecs:   finish,
      startEpoch,
      waveOffset,
      cumPositions: {}, // filled in second/third pass
    };
  });

  // ── RTRT path: convert per-athlete startEpoch → waveOffset ──────────────────
  if (rtrtStarts) {
    const epochs = athletes.map((a) => a.startEpoch).filter((e) => e != null);
    const minEpoch = epochs.length ? Math.min(...epochs) : 0;
    for (const a of athletes) {
      if (a.startEpoch != null) {
        a.waveOffset = Math.round((a.startEpoch - minEpoch) * 1000) / 1000;
      }
      // Athletes with no RTRT record get their division's median offset (below)
    }
  }

  // Second pass: for athletes without a wave offset, use division peers' median
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

  const hasWaveData =
    (rtrtStarts && rtrtStarts.size > 0) ||
    athletes.some((a) => a.waveOffset != null && a.waveOffset !== 0) ||
    (externalWaveOffsets && externalWaveOffsets.size > 0);

  for (const a of athletes) {
    if (a.waveOffset != null) continue;
    const divOffsets = offsetsByDiv.get(a.division);
    a.waveOffset = divOffsets?.length ? medianOffset(divOffsets) : 0;
  }

  // Third pass: compute cumulative physical positions for each leg.
  // cumPositions[leg] = waveOffset + sum of all leg seconds up to and including this leg.
  // This represents the athlete's "physical position on course" (seconds since the
  // first athlete started) at the END of each leg — used by the passing algorithm.
  for (const a of athletes) {
    let cumChip = 0;
    for (const leg of legNames) {
      const v = a.legSecs[leg];
      if (v != null && cumChip !== null) {
        cumChip += v;
        a.cumPositions[leg] = a.waveOffset + cumChip;
      } else {
        cumChip = null;
        a.cumPositions[leg] = null; // athlete dropped out before or during this leg
      }
    }
  }

  return { athletes, hasWaveData };
}

// ─── Passing Algorithm ────────────────────────────────────────────────────────

/**
 * Build a rank map (bib → rank, 1=first) sorted by the given time function.
 * Athletes with null times are excluded.
 */
function buildRankMap(athletes, getTime) {
  const eligible = athletes.filter((a) => getTime(a) != null);
  const sorted = [...eligible].sort((a, b) => getTime(a) - getTime(b));
  const map = new Map();
  sorted.forEach((a, i) => map.set(a.bib, i + 1));
  return map;
}

/**
 * Compute passing data for all athletes across all legs.
 *
 * legNames: ordered array of leg names, e.g. ["Swim","T1","Bike","T2","Run"]
 *           or ["5K","Run"] for a road race with one intermediate split.
 *
 * hasWaveData: whether per-athlete start positions are known.
 *
 * For each leg:
 *   beforeMap = rank by physical position at START of the leg
 *   afterMap  = rank by physical position at END of the leg
 *
 *   passedBibs   = bibs where beforeRank < beforeRank[X] AND afterRank > afterRank[X]
 *                  (they were physically ahead of X before the leg, behind X after)
 *
 *   passedByBibs = bibs where beforeRank > beforeRank[X] AND afterRank < afterRank[X]
 *                  (they were physically behind X before the leg, ahead of X after)
 *
 * First-leg handling (the only sport-specific logic):
 *
 *   Physical mode (hasWaveData = true):
 *     "Before" = athlete's physical position when they began the first leg.
 *     For TT/wave-start races, this is their waveOffset (seconds after the
 *     first starter). Athletes with smaller waveOffset were physically ahead.
 *     Uses the standard before→after comparison.
 *
 *   Gun-start mode (hasWaveData = false):
 *     Everyone starts simultaneously — no meaningful "before" position exists.
 *     Passing = pure comparison of first-leg exit ranks.
 *
 * maxBibs: cap on the number of bib strings stored per athlete per leg.
 *   0 = unlimited. For large races (10k+ athletes), cap at a reasonable number
 *   to keep memory and CSV size manageable.
 */
function computePassingData(athletes, legNames, hasWaveData = false, maxBibs = 0) {
  // Build leg definitions dynamically
  const legs = legNames.map((name, i) => ({
    name,
    // "Before" position = physical position at START of this leg
    getBefore:
      i === 0
        ? hasWaveData
          ? (a) => a.waveOffset                          // first leg, physical mode
          : null                                          // first leg, gun-start mode
        : (a) => a.cumPositions[legNames[i - 1]],        // all other legs: end of prev leg
    // "After" position = physical position at END of this leg
    getAfter: (a) => a.cumPositions[name],
  }));

  // Initialise result map: bib → { [legName]: stats }
  const results = new Map();
  for (const a of athletes) {
    const entry = {};
    for (const leg of legNames) {
      entry[leg] = { gained: 0, lost: 0, passedBibs: [], passedByBibs: [] };
    }
    results.set(a.bib, entry);
  }

  for (const leg of legs) {
    const afterMap = buildRankMap(athletes, leg.getAfter);
    const eligible = athletes.filter((a) => afterMap.has(a.bib));

    let beforeMap;
    const isGunStart = leg.name === legNames[0] && !hasWaveData;

    if (isGunStart) {
      // All start simultaneously — rank everyone as 1 before the first leg
      beforeMap = new Map(eligible.map((a) => [a.bib, 1]));
    } else {
      beforeMap = buildRankMap(athletes, leg.getBefore);
      // Only compare athletes who have BOTH before and after positions
      eligible.splice(
        0,
        eligible.length,
        ...eligible.filter((a) => beforeMap.has(a.bib))
      );
    }

    for (const x of eligible) {
      const xBefore  = beforeMap.get(x.bib);
      const xAfter   = afterMap.get(x.bib);
      const legData  = results.get(x.bib)[leg.name];

      for (const y of eligible) {
        if (y.bib === x.bib) continue;

        const yBefore = beforeMap.get(y.bib);
        const yAfter  = afterMap.get(y.bib);
        if (yBefore == null || yAfter == null) continue;

        if (isGunStart) {
          // Gun start: no meaningful before — compare first-leg exits only
          if (yAfter > xAfter) {
            legData.gained++;
            if (maxBibs === 0 || legData.passedBibs.length < maxBibs)
              legData.passedBibs.push(y.bib);
          } else if (yAfter < xAfter) {
            legData.lost++;
            if (maxBibs === 0 || legData.passedByBibs.length < maxBibs)
              legData.passedByBibs.push(y.bib);
          }
        } else {
          // Standard: y was physically ahead of x before AND behind after → x passed y
          if (yBefore < xBefore && yAfter > xAfter) {
            legData.gained++;
            if (maxBibs === 0 || legData.passedBibs.length < maxBibs)
              legData.passedBibs.push(y.bib);
          } else if (yBefore > xBefore && yAfter < xAfter) {
            legData.lost++;
            if (maxBibs === 0 || legData.passedByBibs.length < maxBibs)
              legData.passedByBibs.push(y.bib);
          }
        }
      }
    }
  }

  return results;
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────

function fmtTime(secs) {
  if (secs == null) return "--:--:--";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function pad(str, len)  { return String(str).padEnd(len, " ").slice(0, len); }
function rpad(str, len) { return String(str).padStart(len, " ").slice(-len); }

// ─── Report ───────────────────────────────────────────────────────────────────

function printReport(athletes, passingMap, legNames, hasWaveData, maxBibs) {
  const finishers = athletes.filter((a) => a.status === "FIN" && a.finishSecs != null);
  const dnfs      = athletes.filter((a) => a.status === "DNF");

  console.log("\n" + "═".repeat(70));
  console.log("  RACEREPLAY — Passing Analysis Proof of Concept");
  console.log("═".repeat(70));
  console.log(`  Athletes:  ${athletes.length}`);
  console.log(`  Finishers: ${finishers.length}`);
  console.log(`  DNFs:      ${dnfs.length}`);
  console.log(`  Legs:      ${legNames.join(", ")}`);
  if (maxBibs > 0) {
    console.log(`  Bib lists: capped at ${maxBibs} per athlete per leg (--max-bibs)`);
  }

  const rtrtCount = athletes.filter((a) => a.startEpoch != null).length;
  const modeLabel = rtrtCount > 0
    ? `✅ Physical passing — RTRT start times (${rtrtCount} athletes matched)`
    : hasWaveData
    ? "✅ Physical passing — wave offsets applied"
    : "⚠️  Chip time only — no start time data\n" +
      "     For physical passing, use --rtrt-starts with a _starts.csv";
  console.log(`  Mode:      ${modeLabel}`);
  console.log("═".repeat(70));

  // ── Invariant check ─────────────────────────────────────────────────────────
  let invariantOk = true;

  console.log("\n📐 INVARIANT CHECK  (sum of gained must equal sum of lost per leg)");
  console.log("─".repeat(50));

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

  // ── Top 5 finishers ──────────────────────────────────────────────────────────
  const sorted = finishers
    .filter((a) => a.overallRank != null)
    .sort((a, b) => a.overallRank - b.overallRank);

  console.log("\n\n🏆 TOP 5 FINISHERS — Leg-by-leg passing breakdown");
  console.log("─".repeat(70));
  console.log(
    `  ${"Rank".padEnd(5)} ${"Name".padEnd(28)} ${"Div".padEnd(8)} ${"Finish".padEnd(9)} Net`
  );
  console.log("─".repeat(70));

  for (const a of sorted.slice(0, 5)) {
    const d = passingMap.get(a.bib);
    if (!d) continue;
    const net = legNames.reduce((sum, l) => sum + d[l].gained - d[l].lost, 0);
    console.log(
      `  ${rpad(a.overallRank, 4)}  ${pad(a.name, 28)} ${pad(a.division, 8)} ${fmtTime(a.finishSecs).padEnd(9)} ${net >= 0 ? "+" : ""}${net}`
    );
    for (const leg of legNames) {
      const { gained, lost, passedBibs } = d[leg];
      const legNet = gained - lost;
      console.log(
        `         ${pad(leg, 8)}  +${rpad(gained, 3)} / -${rpad(lost, 3)}  net ${legNet >= 0 ? "+" : ""}${legNet}` +
        (passedBibs.length > 0 && passedBibs.length <= 5
          ? `  passed: ${passedBibs.slice(0, 5).join(", ")}`
          : passedBibs.length > 5
          ? `  passed ${gained} athletes${maxBibs > 0 ? ` (showing ${passedBibs.length})` : ""}`
          : "")
      );
    }
    console.log();
  }

  // ── Biggest climbers ─────────────────────────────────────────────────────────
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
  console.log(
    `  ${"Rank".padEnd(5)} ${"Name".padEnd(28)} ${"Div".padEnd(8)} ${"Finish".padEnd(9)} Net`
  );
  console.log("─".repeat(70));
  for (const a of withNet.slice(0, 10)) {
    const d = passingMap.get(a.bib);
    const perLeg = legNames
      .map((l) => `${l}:${d[l].gained - d[l].lost >= 0 ? "+" : ""}${d[l].gained - d[l].lost}`)
      .join("  ");
    console.log(
      `  ${rpad(a.overallRank, 4)}  ${pad(a.name, 28)} ${pad(a.division, 8)} ${fmtTime(a.finishSecs).padEnd(9)} +${a.net}`
    );
    console.log(`         ${perLeg}`);
  }

  // ── Biggest fallers ───────────────────────────────────────────────────────────
  console.log("\n📉 BIGGEST FALLERS (most net positions lost)");
  console.log("─".repeat(70));
  for (const a of withNet.slice(-10).reverse()) {
    const d = passingMap.get(a.bib);
    const perLeg = legNames
      .map((l) => `${l}:${d[l].gained - d[l].lost >= 0 ? "+" : ""}${d[l].gained - d[l].lost}`)
      .join("  ");
    console.log(
      `  ${rpad(a.overallRank, 4)}  ${pad(a.name, 28)} ${pad(a.division, 8)} ${fmtTime(a.finishSecs).padEnd(9)} ${a.net}`
    );
    console.log(`         ${perLeg}`);
  }

  console.log("\n" + "═".repeat(70) + "\n");
}

// ─── CSV Output ───────────────────────────────────────────────────────────────

function buildOutputCSV(athletes, passingMap, legNames, maxBibs) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  // Build headers dynamically from leg names
  const headers = [
    "Bib", "Name", "Gender", "Country", "Division", "Status",
    "Overall Rank", "Gender Rank", "Division Rank",
    "Finish Time",
    ...legNames.map((l) => `${l} Time`),
    "Wave Offset (Seconds)",
    ...legNames.flatMap((l) => [`${l} Gained`, `${l} Lost`, `${l} Net`]),
    "Overall Net",
    ...legNames.flatMap((l) => [`${l} Passed Bibs`, `${l} Passed By Bibs`]),
  ];

  const rows = athletes.map((a) => {
    const d = passingMap.get(a.bib);
    const overallNet = d
      ? legNames.reduce((sum, l) => sum + d[l].gained - d[l].lost, 0)
      : 0;

    const row = [
      a.bib, a.name, a.gender, a.country, a.division, a.status,
      a.overallRank ?? "", a.genderRank ?? "", a.divisionRank ?? "",
      fmtTime(a.finishSecs),
      ...legNames.map((l) => fmtTime(a.legSecs[l])),
      a.waveOffset ?? 0,
    ];

    if (d) {
      for (const leg of legNames) {
        const net = d[leg].gained - d[leg].lost;
        row.push(d[leg].gained, d[leg].lost, net);
      }
      row.push(overallNet);
      for (const leg of legNames) {
        row.push(d[leg].passedBibs.join("|"));
        row.push(d[leg].passedByBibs.join("|"));
      }
    } else {
      // No passing data (shouldn't happen)
      for (let i = 0; i < legNames.length * 3 + 1 + legNames.length * 2; i++) row.push("");
    }

    return row.map(esc).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const csvFile        = args.find((a) => !a.startsWith("--"));
const waveOffsetsIdx = args.indexOf("--wave-offsets");
const waveOffsetsFile = waveOffsetsIdx !== -1 ? args[waveOffsetsIdx + 1] : null;
const rtrtStartsIdx  = args.indexOf("--rtrt-starts");
const rtrtStartsFile = rtrtStartsIdx  !== -1 ? args[rtrtStartsIdx  + 1] : null;
const maxBibsIdx     = args.indexOf("--max-bibs");
const maxBibs        = maxBibsIdx !== -1 ? parseInt(args[maxBibsIdx + 1], 10) : 0;

if (!csvFile) {
  console.error(`
Usage: node scripts/analyze-passing.mjs <csv-file> [options]

  The legs are auto-detected from the CSV columns — works with any race format.

Options:
  --rtrt-starts <file>   Per-athlete start times (enables physical passing)
  --wave-offsets <file>  Per-division wave offsets in seconds (JSON) — fallback
  --max-bibs <n>         Cap bib lists at N per athlete per leg (default: unlimited)
                         Recommended for races with 10,000+ athletes

Examples:
  # Triathlon with RTRT start times
  node scripts/analyze-passing.mjs scripts/data/IRM-OCEANSIDE703-2026.csv \\
    --rtrt-starts scripts/data/irm-oceanside703-2026_starts.csv

  # Road race with RTRT start times, capped bib lists
  node scripts/analyze-passing.mjs scripts/data/BASS2026.csv \\
    --rtrt-starts scripts/data/bass2026_starts.csv --max-bibs 50

  # Chip time only
  node scripts/analyze-passing.mjs scripts/data/race.csv
`);
  process.exit(1);
}

(async () => {
  try {
    // Load RTRT per-athlete start times (highest priority)
    let rtrtStarts = null;
    if (rtrtStartsFile) {
      console.log(`\n🏁 Loading RTRT start times from ${rtrtStartsFile}...`);
      const raw = await fs.readFile(rtrtStartsFile, "utf-8");
      const startRows = parseCSV(raw);
      rtrtStarts = new Map(
        startRows
          .filter((r) => r["Bib"] && r["StartEpoch"])
          .map((r) => [String(r["Bib"]), parseFloat(r["StartEpoch"])])
      );
      console.log(`   ${rtrtStarts.size} athlete start times loaded`);
    }

    // Load external wave offsets (fallback)
    let externalWaveOffsets = null;
    if (waveOffsetsFile && !rtrtStartsFile) {
      console.log(`\n🌊 Loading wave offsets from ${waveOffsetsFile}...`);
      const raw = await fs.readFile(waveOffsetsFile, "utf-8");
      const obj = JSON.parse(raw);
      externalWaveOffsets = new Map(Object.entries(obj).map(([k, v]) => [k, Number(v)]));
      console.log(`   ${externalWaveOffsets.size} division(s) loaded`);
    }

    console.log(`\n📂 Reading ${csvFile}...`);
    const raw  = await fs.readFile(csvFile, "utf-8");
    const rows = parseCSV(raw);
    console.log(`   ${rows.length} rows parsed`);

    if (!rows.length) throw new Error("CSV is empty");

    // Auto-detect leg names from CSV headers
    const legNames = detectLegs(rows[0]);
    if (!legNames.length) throw new Error("No leg columns found in CSV (expected columns like 'Swim (Seconds)')");
    console.log(`   Legs detected: ${legNames.join(", ")}`);

    const { athletes, hasWaveData } = normaliseAthletes(rows, legNames, rtrtStarts, externalWaveOffsets);

    let modeMsg;
    if (rtrtStarts) {
      const matched = athletes.filter((a) => a.startEpoch != null).length;
      modeMsg = `RTRT start times matched to ${matched}/${athletes.length} athletes — physical passing mode active.`;
    } else if (hasWaveData) {
      modeMsg = "Wave offsets applied — physical passing mode active.";
    } else {
      modeMsg = "No start times — using chip time comparisons only.";
    }
    console.log(`   ${modeMsg}`);

    if (maxBibs > 0) {
      console.log(`   Bib list cap: ${maxBibs} per athlete per leg`);
    }

    console.log(`   Running passing algorithm...`);
    const passingMap = computePassingData(athletes, legNames, hasWaveData, maxBibs);
    console.log(`   Done. Computing report...`);

    printReport(athletes, passingMap, legNames, hasWaveData, maxBibs);

    const outputFile = csvFile.replace(/\.csv$/i, "_passing.csv");
    const outputCSV  = buildOutputCSV(athletes, passingMap, legNames, maxBibs);
    await fs.writeFile(outputFile, outputCSV);
    console.log(`📄 Passing data written to: ${outputFile}\n`);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
})();
