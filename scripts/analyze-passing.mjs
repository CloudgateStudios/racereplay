#!/usr/bin/env node
/**
 * analyze-passing.mjs
 *
 * Reads an Ironman results CSV (from fetch-race.mjs), runs the leg-by-leg
 * passing analysis algorithm, prints a verification report to stdout, and
 * writes a full per-athlete passing CSV alongside the input file.
 *
 * Usage:
 *   node scripts/analyze-passing.mjs <csv-file> [--wave-offsets <file.json>]
 *
 * Example (chip time only — same-wave athletes only):
 *   node scripts/analyze-passing.mjs scripts/data/oceanside_2026.csv
 *
 * Example (physical passing — cross-wave accurate):
 *   node scripts/analyze-passing.mjs scripts/data/oceanside_2026.csv \
 *     --wave-offsets scripts/data/oceanside_2026_waves.json
 *
 * Wave offsets file format (seconds after official gun):
 *   {
 *     "MPRO":   0,
 *     "FPRO":   180,
 *     "M18-24": 600,
 *     "M25-29": 780,
 *     ...
 *   }
 *   Division names must match the "Division" column in the results CSV exactly.
 *   See scripts/data/wave-offsets-example.json for a template.
 *
 * Output CSV:
 *   scripts/data/oceanside_2026_passing.csv
 *
 * Output CSV columns:
 *   Bib, Name, Gender, Country, Division, Status,
 *   Overall Rank, Gender Rank, Division Rank,
 *   Finish Time, Swim Time, T1 Time, Bike Time, T2 Time, Run Time,
 *   Wave Offset (Seconds),
 *   Swim Gained, Swim Lost, Swim Net,
 *   T1 Gained,   T1 Lost,   T1 Net,
 *   Bike Gained, Bike Lost, Bike Net,
 *   T2 Gained,   T2 Lost,   T2 Net,
 *   Run Gained,  Run Lost,  Run Net,
 *   Overall Net,
 *   Swim Passed Bibs, Swim Passed By Bibs,
 *   T1 Passed Bibs,   T1 Passed By Bibs,
 *   Bike Passed Bibs, Bike Passed By Bibs,
 *   T2 Passed Bibs,   T2 Passed By Bibs,
 *   Run Passed Bibs,  Run Passed By Bibs
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

// ─── Data Normalisation ───────────────────────────────────────────────────────

/**
 * normaliseAthletes(rows, rtrtStarts?, externalWaveOffsets?)
 *
 * rtrtStarts: Map<bib, startEpochSeconds> loaded from a --rtrt-starts CSV.
 *   These are precise per-athlete Unix timestamps from the RTRT.me live
 *   tracking system (the IRONMAN Tracker app backend). Each athlete's
 *   startEpoch is the exact moment they crossed the start timing mat.
 *
 *   Gun-time cumulative at any checkpoint:
 *     gunCum = startEpoch + chipSplitSeconds
 *   Because epoch times are absolute, comparing two athletes' gunCum values
 *   at a given checkpoint directly answers "who was physically ahead?"
 *
 *   Note: We subtract the earliest startEpoch in the field so cumulative
 *   values are relative seconds (not raw Unix timestamps), which keeps the
 *   numbers human-readable and avoids float precision issues.
 *
 * externalWaveOffsets: Map<divisionName, offsetSeconds> — fallback for wave-
 *   start races when RTRT data is unavailable. Loaded from --wave-offsets JSON.
 */
function normaliseAthletes(rows, rtrtStarts = null, externalWaveOffsets = null) {
  // First pass: parse all raw fields
  const athletes = rows.map((r) => {
    const secs = (col) => {
      const v = parseInt(r[col], 10);
      return isNaN(v) || v <= 0 ? null : v;
    };

    const swim   = secs("Swim (Seconds)");
    const t1     = secs("T1 (Seconds)");
    const bike   = secs("Bike (Seconds)");
    const t2     = secs("T2 (Seconds)");
    const run    = secs("Run (Seconds)");
    const finish = secs("Finish (Seconds)");
    const gunFinish = secs("Finish Gun (Seconds)");

    const bib      = r["Bib Number"] || "?";
    const division = r["Division"] || "";

    // startEpoch: per-athlete Unix timestamp of their actual race start.
    // Used as the basis for gunCum calculations when RTRT data is available.
    const startEpoch = rtrtStarts?.get(String(bib)) ?? null;

    // waveOffset fallback (for non-RTRT / wave-start races):
    // Sources in priority order:
    //   1. Derived from RTRT startEpoch (computed after all epochs known — see below)
    //   2. External wave-offsets file (keyed by division name)
    //   3. Derived from API gun time field: gunFinish - chipFinish
    //   4. Derived from division peers' median (second pass)
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
      swimSecs:   swim,
      t1Secs:     t1,
      bikeSecs:   bike,
      t2Secs:     t2,
      runSecs:    run,
      finishSecs: finish,
      gunFinishSecs: gunFinish,
      startEpoch,   // null if no RTRT data
      waveOffset,   // null if using RTRT path; filled in second pass otherwise
    };
  });

  // ── RTRT path: convert per-athlete startEpoch → waveOffset ─────────────────
  // Normalise epoch times to seconds relative to the earliest starter, so
  // cumulative values stay small and human-readable.
  if (rtrtStarts) {
    const epochs = athletes.map((a) => a.startEpoch).filter((e) => e != null);
    const minEpoch = epochs.length ? Math.min(...epochs) : 0;

    for (const a of athletes) {
      if (a.startEpoch != null) {
        // waveOffset = seconds this athlete started after the first athlete
        a.waveOffset = Math.round((a.startEpoch - minEpoch) * 1000) / 1000;
      }
      // DNFs / untracked athletes with no RTRT record: fall back to division median (below)
    }
  }

  // Second pass: for any athlete still without a wave offset, derive from
  // division peers' median (handles DNFs, athletes missing from RTRT data, etc.)
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

  const hasWaveData = (rtrtStarts && rtrtStarts.size > 0)
    || athletes.some((a) => a.waveOffset != null && a.waveOffset !== 0)
    || (externalWaveOffsets && externalWaveOffsets.size > 0);

  for (const a of athletes) {
    if (a.waveOffset != null) continue;
    const divOffsets = offsetsByDiv.get(a.division);
    a.waveOffset = divOffsets?.length ? medianOffset(divOffsets) : 0;
  }

  // Third pass: compute gun time cumulative splits.
  // gun_cum_X = waveOffset + chip_cum_X
  // These represent actual clock time at each course boundary, so comparing
  // two athletes' gun_cum values tells you who was physically ahead on course.
  for (const a of athletes) {
    const w = a.waveOffset;
    const { swimSecs: sw, t1Secs: t1, bikeSecs: bk, t2Secs: t2, finishSecs: fin } = a;

    a.cumAfterSwim  = sw != null                                             ? w + sw             : null;
    a.cumAfterT1    = sw != null && t1 != null                               ? w + sw + t1        : null;
    a.cumAfterBike  = sw != null && t1 != null && bk != null                 ? w + sw + t1 + bk   : null;
    a.cumAfterT2    = sw != null && t1 != null && bk != null && t2 != null   ? w + sw + t1 + bk + t2 : null;
    a.cumFinish     = fin != null                                            ? w + fin            : null;
  }

  return { athletes, hasWaveData };
}

// ─── Passing Algorithm ────────────────────────────────────────────────────────

/**
 * Build a rank map (bib → rank, 1=best) from a list of athletes using the
 * given cumulative time function. Athletes with null times are excluded.
 */
function buildRankMap(athletes, getTime) {
  const eligible = athletes.filter((a) => getTime(a) != null);
  const sorted = [...eligible].sort((a, b) => getTime(a) - getTime(b));
  const map = new Map();
  sorted.forEach((a, i) => map.set(a.bib, i + 1));
  return map;
}

/**
 * Compute passing data for all athletes across all 5 legs.
 *
 * For each leg:
 *   - beforeMap: rank by cumulative time at leg START
 *   - afterMap:  rank by cumulative time at leg END
 *
 * passedBibs   = bibs where beforeRank < beforeRank[X]  AND afterRank > afterRank[X]
 *                (they were ahead of X before, behind X after — X overtook them)
 *
 * passedByBibs = bibs where beforeRank > beforeRank[X]  AND afterRank < afterRank[X]
 *                (they were behind X before, ahead X after — they overtook X)
 *
 * Swim handling depends on start mode:
 *
 *   TT/wave start (hasWaveData = true):
 *     "Before" = athlete's physical position when they entered the water,
 *     ranked by their actual start time (waveOffset). Athletes who started
 *     earlier were physically ahead in the water.
 *     Uses the standard before→after comparison — no special case needed.
 *
 *   Simultaneous gun start (hasWaveData = false):
 *     Everyone enters the water at the same instant, so there is no
 *     meaningful "before" position. Passing = pure comparison of swim exit
 *     ranks (who exited the water first).
 */
function computePassingData(athletes, hasWaveData = false) {
  const legs = [
    {
      name: "swim",
      // getBefore: null in simultaneous-start mode; set to waveOffset in TT/wave mode below
      getBefore: hasWaveData ? (a) => a.waveOffset : null,
      getAfter:  (a) => a.cumAfterSwim,
    },
    {
      name: "t1",
      getBefore: (a) => a.cumAfterSwim,
      getAfter:  (a) => a.cumAfterT1,
    },
    {
      name: "bike",
      getBefore: (a) => a.cumAfterT1,
      getAfter:  (a) => a.cumAfterBike,
    },
    {
      name: "t2",
      getBefore: (a) => a.cumAfterBike,
      getAfter:  (a) => a.cumAfterT2,
    },
    {
      name: "run",
      getBefore: (a) => a.cumAfterT2,
      getAfter:  (a) => a.cumFinish,
    },
  ];

  // Initialise result map: bib → { swim, t1, bike, t2, run, overall }
  const results = new Map();
  for (const a of athletes) {
    results.set(a.bib, {
      swim: { gained: 0, lost: 0, passedBibs: [], passedByBibs: [] },
      t1:   { gained: 0, lost: 0, passedBibs: [], passedByBibs: [] },
      bike: { gained: 0, lost: 0, passedBibs: [], passedByBibs: [] },
      t2:   { gained: 0, lost: 0, passedBibs: [], passedByBibs: [] },
      run:  { gained: 0, lost: 0, passedBibs: [], passedByBibs: [] },
    });
  }

  for (const leg of legs) {
    const afterMap = buildRankMap(athletes, leg.getAfter);

    // Athletes eligible for this leg = those who have a valid after-time
    const eligible = athletes.filter((a) => afterMap.has(a.bib));

    let beforeMap;
    const swimSimultaneous = leg.name === "swim" && !hasWaveData;

    if (swimSimultaneous) {
      // Simultaneous gun start: everyone enters the water together.
      // No meaningful "before" position — passing = pure swim exit rank comparison.
      beforeMap = new Map(eligible.map((a) => [a.bib, 1]));
    } else {
      beforeMap = buildRankMap(athletes, leg.getBefore);
      // Only keep athletes who have BOTH a before and after rank
      eligible.splice(
        0,
        eligible.length,
        ...eligible.filter((a) => beforeMap.has(a.bib))
      );
    }

    // For each eligible athlete X, find who they passed and who passed them
    for (const x of eligible) {
      const xBefore = beforeMap.get(x.bib);
      const xAfter  = afterMap.get(x.bib);
      const legData = results.get(x.bib)[leg.name];

      for (const y of eligible) {
        if (y.bib === x.bib) continue;

        const yBefore = beforeMap.get(y.bib);
        const yAfter  = afterMap.get(y.bib);
        if (yBefore == null || yAfter == null) continue;

        if (swimSimultaneous) {
          // Gun start: no before position — compare swim exits only
          if (yAfter > xAfter) {
            // y exited swim after x — x was faster, x "passed" y
            legData.passedBibs.push(y.bib);
            legData.gained++;
          } else if (yAfter < xAfter) {
            // y exited swim before x — y was faster, y "passed" x
            legData.passedByBibs.push(y.bib);
            legData.lost++;
          }
        } else {
          // Standard case (all legs, plus swim when hasWaveData)
          if (yBefore < xBefore && yAfter > xAfter) {
            // y was ahead before, behind after — x passed y
            legData.passedBibs.push(y.bib);
            legData.gained++;
          } else if (yBefore > xBefore && yAfter < xAfter) {
            // y was behind before, ahead after — y passed x
            legData.passedByBibs.push(y.bib);
            legData.lost++;
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

function pad(str, len) {
  return String(str).padEnd(len, " ").slice(0, len);
}

function rpad(str, len) {
  return String(str).padStart(len, " ").slice(-len);
}

// ─── Report ───────────────────────────────────────────────────────────────────

function printReport(athletes, passingMap, hasWaveData) {
  const finishers = athletes.filter((a) => a.status === "FIN" && a.finishSecs != null);
  const dnfs = athletes.filter((a) => a.status === "DNF");

  console.log("\n" + "═".repeat(70));
  console.log("  RACEREPLAY — Passing Analysis Proof of Concept");
  console.log("═".repeat(70));
  console.log(`  Athletes:  ${athletes.length}`);
  console.log(`  Finishers: ${finishers.length}`);
  console.log(`  DNFs:      ${dnfs.length}`);
  const rtrtCount = athletes.filter((a) => a.startEpoch != null).length;
  const modeLabel = rtrtCount > 0
    ? `✅ Physical passing — RTRT start times (${rtrtCount} athletes matched)`
    : hasWaveData
    ? "✅ Physical passing — wave offsets applied"
    : "⚠️  Chip time only — same-wave comparisons only\n" +
      "     Run fetch-rtrt-starts.mjs and pass --rtrt-starts for physical passing";
  console.log(`  Mode:      ${modeLabel}`);
  console.log("═".repeat(70));

  // ── Invariant check ─────────────────────────────────────────────────────────
  const legNames = ["swim", "t1", "bike", "t2", "run"];
  let invariantOk = true;

  console.log("\n📐 INVARIANT CHECK  (sum of gained must equal sum of lost per leg)");
  console.log("─".repeat(50));

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
      `  ${icon}  ${pad(leg.toUpperCase(), 5)}  gained=${rpad(totalGained, 6)}  lost=${rpad(totalLost, 6)}  ${ok ? "MATCH" : "MISMATCH ← BUG"}`
    );
  }

  console.log(`\n  Overall invariant: ${invariantOk ? "✅ PASS" : "❌ FAIL"}`);

  // ── Top finishers breakdown ──────────────────────────────────────────────────
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
      const net = gained - lost;
      console.log(
        `         ${pad(leg, 5)}  +${rpad(gained, 3)} / -${rpad(lost, 3)}  net ${net >= 0 ? "+" : ""}${net}` +
          (passedBibs.length > 0 && passedBibs.length <= 5
            ? `  passed: ${passedBibs.slice(0, 5).join(", ")}`
            : passedBibs.length > 5
            ? `  passed ${passedBibs.length} athletes`
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
    const perLeg = legNames.map((l) => {
      const net = d[l].gained - d[l].lost;
      return `${l}:${net >= 0 ? "+" : ""}${net}`;
    }).join("  ");
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
    const perLeg = legNames.map((l) => {
      const net = d[l].gained - d[l].lost;
      return `${l}:${net >= 0 ? "+" : ""}${net}`;
    }).join("  ");
    console.log(
      `  ${rpad(a.overallRank, 4)}  ${pad(a.name, 28)} ${pad(a.division, 8)} ${fmtTime(a.finishSecs).padEnd(9)} ${a.net}`
    );
    console.log(`         ${perLeg}`);
  }

  console.log("\n" + "═".repeat(70) + "\n");
}

// ─── CSV Output ───────────────────────────────────────────────────────────────

function buildOutputCSV(athletes, passingMap) {
  const legNames = ["swim", "t1", "bike", "t2", "run"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const headers = [
    "Bib", "Name", "Gender", "Country", "Division", "Status",
    "Overall Rank", "Gender Rank", "Division Rank",
    "Finish Time", "Swim Time", "T1 Time", "Bike Time", "T2 Time", "Run Time",
    "Wave Offset (Seconds)",
    "Swim Gained", "Swim Lost", "Swim Net",
    "T1 Gained",   "T1 Lost",   "T1 Net",
    "Bike Gained", "Bike Lost", "Bike Net",
    "T2 Gained",   "T2 Lost",   "T2 Net",
    "Run Gained",  "Run Lost",  "Run Net",
    "Overall Net",
    "Swim Passed Bibs",    "Swim Passed By Bibs",
    "T1 Passed Bibs",      "T1 Passed By Bibs",
    "Bike Passed Bibs",    "Bike Passed By Bibs",
    "T2 Passed Bibs",      "T2 Passed By Bibs",
    "Run Passed Bibs",     "Run Passed By Bibs",
  ];

  const rows = athletes.map((a) => {
    const d = passingMap.get(a.bib);
    const overallNet = d
      ? legNames.reduce((sum, l) => sum + d[l].gained - d[l].lost, 0)
      : 0;

    const row = [
      a.bib, a.name, a.gender, a.country, a.division, a.status,
      a.overallRank ?? "", a.genderRank ?? "", a.divisionRank ?? "",
      fmtTime(a.finishSecs), fmtTime(a.swimSecs), fmtTime(a.t1Secs),
      fmtTime(a.bikeSecs),   fmtTime(a.t2Secs),   fmtTime(a.runSecs),
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
      // No passing data (shouldn't happen, but be safe)
      for (let i = 0; i < 15 + 1 + 10; i++) row.push("");
    }

    return row.map(esc).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const csvFile = args.find((a) => !a.startsWith("--"));
const waveOffsetsIdx  = args.indexOf("--wave-offsets");
const waveOffsetsFile = waveOffsetsIdx  !== -1 ? args[waveOffsetsIdx  + 1] : null;
const rtrtStartsIdx   = args.indexOf("--rtrt-starts");
const rtrtStartsFile  = rtrtStartsIdx  !== -1 ? args[rtrtStartsIdx  + 1] : null;

if (!csvFile) {
  console.error(`
Usage: node scripts/analyze-passing.mjs <csv-file> [options]

Options:
  --rtrt-starts <file.csv>    Per-athlete start times from fetch-rtrt-starts.mjs
                              (most accurate — enables true physical passing)
  --wave-offsets <file.json>  Per-division wave offsets in seconds (wave-start races)

Examples:
  # TT start race with RTRT start times (recommended)
  node scripts/analyze-passing.mjs scripts/data/oceanside_2025.csv \\
    --rtrt-starts scripts/data/irm-oceanside703-2025_starts.csv

  # Wave start race with known wave schedule
  node scripts/analyze-passing.mjs scripts/data/oceanside_2025.csv \\
    --wave-offsets scripts/data/oceanside_2025_waves.json

  # Chip time only (same-wave comparisons)
  node scripts/analyze-passing.mjs scripts/data/oceanside_2025.csv
`);
  process.exit(1);
}

(async () => {
  try {
    // Load RTRT per-athlete start times if provided (highest priority)
    let rtrtStarts = null;
    if (rtrtStartsFile) {
      console.log(`\n🏁 Loading RTRT start times from ${rtrtStartsFile}...`);
      const raw = await fs.readFile(rtrtStartsFile, "utf-8");
      const startRows = parseCSV(raw);
      // Map bib (string) → startEpoch (float seconds)
      rtrtStarts = new Map(
        startRows
          .filter((r) => r["Bib"] && r["StartEpoch"])
          .map((r) => [String(r["Bib"]), parseFloat(r["StartEpoch"])])
      );
      console.log(`   ${rtrtStarts.size} athlete start times loaded`);
    }

    // Load wave offsets if provided (fallback for wave-start races)
    let externalWaveOffsets = null;
    if (waveOffsetsFile && !rtrtStartsFile) {
      console.log(`\n🌊 Loading wave offsets from ${waveOffsetsFile}...`);
      const raw = await fs.readFile(waveOffsetsFile, "utf-8");
      const obj = JSON.parse(raw);
      externalWaveOffsets = new Map(Object.entries(obj).map(([k, v]) => [k, Number(v)]));
      console.log(`   ${externalWaveOffsets.size} division(s) loaded`);
    }

    console.log(`\n📂 Reading ${csvFile}...`);
    const raw = await fs.readFile(csvFile, "utf-8");
    const rows = parseCSV(raw);
    console.log(`   ${rows.length} rows parsed`);

    const { athletes, hasWaveData } = normaliseAthletes(rows, rtrtStarts, externalWaveOffsets);
    let modeMsg;
    if (rtrtStarts) {
      const matched = athletes.filter((a) => a.startEpoch != null).length;
      modeMsg = `RTRT start times matched to ${matched}/${athletes.length} athletes — physical passing mode active.`;
    } else if (hasWaveData) {
      modeMsg = "Wave offsets applied — physical passing mode active.";
    } else {
      modeMsg = "No start times — using chip time (same-wave comparisons only).";
    }
    console.log(`   ${modeMsg}`);
    console.log(`   Running passing algorithm...`);

    const passingMap = computePassingData(athletes, hasWaveData);
    console.log(`   Done. Computing report...`);

    printReport(athletes, passingMap, hasWaveData);

    // Write output CSV alongside the input file
    const outputFile = csvFile.replace(/\.csv$/i, "_passing.csv");
    const outputCSV = buildOutputCSV(athletes, passingMap);
    await fs.writeFile(outputFile, outputCSV);
    console.log(`📄 Passing data written to: ${outputFile}\n`);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
})();
