#!/usr/bin/env node
/**
 * analyze-passing.mjs
 *
 * Reads a race results CSV (from fetch-rtrt-event.mjs), runs the leg-by-leg
 * passing analysis algorithm, prints a verification report to stdout, and
 * writes a full per-athlete passing CSV alongside the input file.
 *
 * Legs are auto-detected from CSV column headers. Any column matching
 * "* (Seconds)" (other than "Finish (Seconds)", "Finish Gun (Seconds)",
 * "Wave Offset (Seconds)") is treated as a timed leg, in column order.
 *
 * Usage:
 *   node scripts/analyze-passing.mjs <csv-file> [options]
 *
 * Options:
 *   --rtrt-starts <file>   Per-athlete start epoch times (_starts.csv from
 *                          fetch-rtrt-event.mjs). Enables physical passing
 *                          for TT or wave-start races.
 *   --wave-offsets <file>  Per-division wave offsets in seconds (JSON).
 *                          Fallback for wave-start races without RTRT data.
 *
 * Examples:
 *   node scripts/analyze-passing.mjs scripts/data/IRM-OCEANSIDE703-2026.csv \
 *     --rtrt-starts scripts/data/irm-oceanside703-2026_starts.csv
 *
 *   node scripts/analyze-passing.mjs scripts/data/BASS2026.csv \
 *     --rtrt-starts scripts/data/bass2026_starts.csv
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

// ─── Leg Detection ────────────────────────────────────────────────────────────

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

// ─── Data Normalization ───────────────────────────────────────────────────────

function normalizeAthletes(
  rows,
  legNames,
  rtrtStarts = null,
  externalWaveOffsets = null
) {
  const athletes = rows.map((r) => {
    const secs = (col) => {
      const v = parseInt(r[col], 10);
      return isNaN(v) || v <= 0 ? null : v;
    };

    const legSecs = {};
    for (const leg of legNames) {
      legSecs[leg] = secs(`${leg} (Seconds)`);
    }

    const finish = secs("Finish (Seconds)");
    const gunFinish = secs("Finish Gun (Seconds)");
    const bib = r["Bib Number"] || "?";
    const division = r["Division"] || "";
    const startEpoch = rtrtStarts?.get(String(bib)) ?? null;

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
      name: r["Athlete Name"] || "Unknown",
      division,
      gender: r["Gender"] || "",
      country: r["Country"] || "",
      status: r["Status"] || "FIN",
      overallRank: parseInt(r["Overall Rank"], 10) || null,
      genderRank: parseInt(r["Gender Rank"], 10) || null,
      divisionRank: parseInt(r["Division Rank"], 10) || null,
      legSecs,
      finishSecs: finish,
      startEpoch,
      waveOffset,
      cumPositions: {},
    };
  });

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

  const hasWaveData =
    (rtrtStarts && rtrtStarts.size > 0) ||
    athletes.some((a) => a.waveOffset != null && a.waveOffset !== 0) ||
    (externalWaveOffsets && externalWaveOffsets.size > 0);

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

  return { athletes, hasWaveData };
}

// ─── Passing Algorithm ────────────────────────────────────────────────────────

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
    for (const leg of legNames) {
      entry[leg] = { gained: 0, lost: 0 };
    }
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

function printReport(athletes, passingMap, legNames, hasWaveData) {
  const finishers = athletes.filter(
    (a) => a.status === "FIN" && a.finishSecs != null
  );
  const dnfs = athletes.filter((a) => a.status === "DNF");

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
      : "⚠️  Chip time only — no start time data\n" +
        "     For physical passing, use --rtrt-starts with a _starts.csv";
  console.log(`  Mode:      ${modeLabel}`);
  console.log("═".repeat(70));

  // ── Invariant check ──────────────────────────────────────────────────────────
  let invariantOk = true;

  console.log(
    "\n📐 INVARIANT CHECK  (sum of gained must equal sum of lost per leg)"
  );
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
      `  ${icon}  ${pad(leg.toUpperCase(), 8)}  gained=${rpad(
        totalGained,
        7
      )}  lost=${rpad(totalLost, 7)}  ${ok ? "MATCH" : "MISMATCH ← BUG"}`
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
    `  ${"Rank".padEnd(5)} ${"Name".padEnd(28)} ${"Div".padEnd(
      8
    )} ${"Finish".padEnd(9)} Net`
  );
  console.log("─".repeat(70));

  for (const a of sorted.slice(0, 5)) {
    const d = passingMap.get(a.bib);
    if (!d) continue;
    const net = legNames.reduce((sum, l) => sum + d[l].gained - d[l].lost, 0);
    console.log(
      `  ${rpad(a.overallRank, 4)}  ${pad(a.name, 28)} ${pad(
        a.division,
        8
      )} ${fmtTime(a.finishSecs).padEnd(9)} ${net >= 0 ? "+" : ""}${net}`
    );
    for (const leg of legNames) {
      const { gained, lost } = d[leg];
      const legNet = gained - lost;
      console.log(
        `         ${pad(leg, 8)}  +${rpad(gained, 3)} / -${rpad(
          lost,
          3
        )}  net ${legNet >= 0 ? "+" : ""}${legNet}`
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
    `  ${"Rank".padEnd(5)} ${"Name".padEnd(28)} ${"Div".padEnd(
      8
    )} ${"Finish".padEnd(9)} Net`
  );
  console.log("─".repeat(70));
  for (const a of withNet.slice(0, 10)) {
    const d = passingMap.get(a.bib);
    const perLeg = legNames
      .map(
        (l) =>
          `${l}:${d[l].gained - d[l].lost >= 0 ? "+" : ""}${
            d[l].gained - d[l].lost
          }`
      )
      .join("  ");
    console.log(
      `  ${rpad(a.overallRank, 4)}  ${pad(a.name, 28)} ${pad(
        a.division,
        8
      )} ${fmtTime(a.finishSecs).padEnd(9)} +${a.net}`
    );
    console.log(`         ${perLeg}`);
  }

  // ── Biggest fallers ───────────────────────────────────────────────────────────
  console.log("\n📉 BIGGEST FALLERS (most net positions lost)");
  console.log("─".repeat(70));
  for (const a of withNet.slice(-10).reverse()) {
    const d = passingMap.get(a.bib);
    const perLeg = legNames
      .map(
        (l) =>
          `${l}:${d[l].gained - d[l].lost >= 0 ? "+" : ""}${
            d[l].gained - d[l].lost
          }`
      )
      .join("  ");
    console.log(
      `  ${rpad(a.overallRank, 4)}  ${pad(a.name, 28)} ${pad(
        a.division,
        8
      )} ${fmtTime(a.finishSecs).padEnd(9)} ${a.net}`
    );
    console.log(`         ${perLeg}`);
  }

  console.log("\n" + "═".repeat(70) + "\n");
}

// ─── CSV Output ───────────────────────────────────────────────────────────────

function buildOutputCSV(athletes, passingMap, legNames) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const headers = [
    "Bib",
    "Name",
    "Gender",
    "Country",
    "Division",
    "Status",
    "Overall Rank",
    "Gender Rank",
    "Division Rank",
    "Finish Time",
    ...legNames.map((l) => `${l} Time`),
    "Wave Offset (Seconds)",
    ...legNames.flatMap((l) => [`${l} Gained`, `${l} Lost`, `${l} Net`]),
    "Overall Net",
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
      a.division,
      a.status,
      a.overallRank ?? "",
      a.genderRank ?? "",
      a.divisionRank ?? "",
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
    } else {
      for (let i = 0; i < legNames.length * 3 + 1; i++) row.push("");
    }

    return row.map(esc).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const csvFile = args.find((a) => !a.startsWith("--"));
const waveOffsetsIdx = args.indexOf("--wave-offsets");
const waveOffsetsFile = waveOffsetsIdx !== -1 ? args[waveOffsetsIdx + 1] : null;
const rtrtStartsIdx = args.indexOf("--rtrt-starts");
const rtrtStartsFile = rtrtStartsIdx !== -1 ? args[rtrtStartsIdx + 1] : null;

if (!csvFile) {
  console.error(`
Usage: node scripts/analyze-passing.mjs <csv-file> [options]

  Legs are auto-detected from CSV column headers.

Options:
  --rtrt-starts <file>   Per-athlete start times (enables physical passing)
  --wave-offsets <file>  Per-division wave offsets in seconds (JSON) — fallback

Examples:
  node scripts/analyze-passing.mjs scripts/data/IRM-OCEANSIDE703-2026.csv \\
    --rtrt-starts scripts/data/irm-oceanside703-2026_starts.csv

  node scripts/analyze-passing.mjs scripts/data/BASS2026.csv \\
    --rtrt-starts scripts/data/bass2026_starts.csv
`);
  process.exit(1);
}

(async () => {
  try {
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

    let externalWaveOffsets = null;
    if (waveOffsetsFile && !rtrtStartsFile) {
      console.log(`\n🌊 Loading wave offsets from ${waveOffsetsFile}...`);
      const raw = await fs.readFile(waveOffsetsFile, "utf-8");
      const obj = JSON.parse(raw);
      externalWaveOffsets = new Map(
        Object.entries(obj).map(([k, v]) => [k, Number(v)])
      );
      console.log(`   ${externalWaveOffsets.size} division(s) loaded`);
    }

    console.log(`\n📂 Reading ${csvFile}...`);
    const raw = await fs.readFile(csvFile, "utf-8");
    const rows = parseCSV(raw);
    console.log(`   ${rows.length} rows parsed`);

    if (!rows.length) throw new Error("CSV is empty");

    const legNames = detectLegs(rows[0]);
    if (!legNames.length)
      throw new Error(
        "No leg columns found in CSV (expected columns like 'Swim (Seconds)')"
      );
    console.log(`   Legs detected: ${legNames.join(", ")}`);

    const { athletes, hasWaveData } = normalizeAthletes(
      rows,
      legNames,
      rtrtStarts,
      externalWaveOffsets
    );

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

    console.log(`   Running passing algorithm...`);
    const passingMap = computePassingData(athletes, legNames, hasWaveData);
    console.log(`   Done. Computing report...`);

    printReport(athletes, passingMap, legNames, hasWaveData);

    const outputFile = csvFile.replace(/\.csv$/i, "_passing.csv");
    const outputCSV = buildOutputCSV(athletes, passingMap, legNames);
    await fs.writeFile(outputFile, outputCSV);
    console.log(`📄 Passing data written to: ${outputFile}\n`);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
})();
