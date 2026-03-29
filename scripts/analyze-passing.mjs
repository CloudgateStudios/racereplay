#!/usr/bin/env node
/**
 * analyze-passing.mjs
 *
 * Reads an Ironman results CSV (from fetch-race.mjs) and runs the leg-by-leg
 * passing analysis algorithm. Prints a verification report to stdout.
 *
 * Usage:
 *   node scripts/analyze-passing.mjs <csv-file>
 *
 * Example:
 *   node scripts/analyze-passing.mjs scripts/data/oceanside_2026.csv
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

function normaliseAthletes(rows) {
  return rows.map((r) => {
    const secs = (col) => {
      const v = parseInt(r[col], 10);
      return isNaN(v) || v <= 0 ? null : v;
    };

    const swim = secs("Swim (Seconds)");
    const t1   = secs("T1 (Seconds)");
    const bike = secs("Bike (Seconds)");
    const t2   = secs("T2 (Seconds)");
    const run  = secs("Run (Seconds)");
    const finish = secs("Finish (Seconds)");

    return {
      bib:          r["Bib Number"] || "?",
      name:         r["Athlete Name"] || "Unknown",
      division:     r["Division"] || "",
      gender:       r["Gender"] || "",
      country:      r["Country"] || "",
      status:       r["Status"] || "FIN",         // FIN | DNF | DQ
      overallRank:  parseInt(r["Overall Rank"], 10) || null,
      genderRank:   parseInt(r["Gender Rank"], 10) || null,
      divisionRank: parseInt(r["Division Rank"], 10) || null,
      swimSecs:  swim,
      t1Secs:    t1,
      bikeSecs:  bike,
      t2Secs:    t2,
      runSecs:   run,
      finishSecs: finish,
      // Cumulative snapshots (null if athlete didn't reach that point)
      cumAfterSwim:  swim != null ? swim : null,
      cumAfterT1:    swim != null && t1 != null ? swim + t1 : null,
      cumAfterBike:  swim != null && t1 != null && bike != null ? swim + t1 + bike : null,
      cumAfterT2:    swim != null && t1 != null && bike != null && t2 != null ? swim + t1 + bike + t2 : null,
      cumFinish:     finish,
    };
  });
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
 * Swim special case: everyone starts at cumulative 0 (tied). We treat this as
 * everyone starting equal — passedBibs = athletes with worse swim rank,
 * passedByBibs = athletes with better swim rank.
 */
function computePassingData(athletes) {
  const legs = [
    {
      name: "swim",
      // Swim: everyone starts equal at 0
      getBefore: null, // special case — handled below
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
    if (leg.name === "swim") {
      // Everyone starts equal: assign rank based on afterMap size so each athlete
      // "started" at position N/2 — effectively everyone is tied at rank 1.
      // Passing = pure comparison of swim result ranks.
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

        if (leg.name === "swim") {
          // Special case: everyone tied before, just compare swim result
          if (yAfter > xAfter) {
            // y finished swim behind x — x passed y
            legData.passedBibs.push(y.bib);
            legData.gained++;
          } else if (yAfter < xAfter) {
            // y finished swim ahead of x — y passed x
            legData.passedByBibs.push(y.bib);
            legData.lost++;
          }
        } else {
          // Standard case
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

function printReport(athletes, passingMap) {
  const finishers = athletes.filter((a) => a.status === "FIN" && a.finishSecs != null);
  const dnfs = athletes.filter((a) => a.status === "DNF");

  console.log("\n" + "═".repeat(70));
  console.log("  RACEREPLAY — Passing Analysis Proof of Concept");
  console.log("═".repeat(70));
  console.log(`  Athletes:  ${athletes.length}`);
  console.log(`  Finishers: ${finishers.length}`);
  console.log(`  DNFs:      ${dnfs.length}`);
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

// ─── Main ─────────────────────────────────────────────────────────────────────

const [, , csvFile] = process.argv;

if (!csvFile) {
  console.error(`
Usage: node scripts/analyze-passing.mjs <csv-file>

Example:
  node scripts/analyze-passing.mjs scripts/data/oceanside_2026.csv
`);
  process.exit(1);
}

(async () => {
  try {
    console.log(`\n📂 Reading ${csvFile}...`);
    const raw = await fs.readFile(csvFile, "utf-8");
    const rows = parseCSV(raw);
    console.log(`   ${rows.length} rows parsed`);

    const athletes = normaliseAthletes(rows);
    console.log(`   Normalised. Running passing algorithm...`);

    const passingMap = computePassingData(athletes);
    console.log(`   Done. Computing report...`);

    printReport(athletes, passingMap);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
})();
