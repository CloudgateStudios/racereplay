#!/usr/bin/env node
/**
 * fetch-race.mjs
 *
 * Fetches Ironman race results from labs-v2.competitor.com and writes a CSV.
 * Adapted from https://github.com/colinlord/ironman-results (MIT)
 *
 * Usage:
 *   node scripts/fetch-race.mjs <event-group-url> [year] [output-dir]
 *
 * How to find the event-group-url:
 *   1. Go to ironman.com and navigate to the race results page
 *      e.g. https://www.ironman.com/im703-oceanside-results
 *   2. Right-click → View Page Source, search for "labs-v2.competitor.com"
 *   3. Copy the iframe src — looks like:
 *      https://labs-v2.competitor.com/results/event/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *
 * Example:
 *   node scripts/fetch-race.mjs https://labs-v2.competitor.com/results/event/abc-123 2026
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchNextData(url) {
  console.log(`\n📡 Fetching event group page: ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });

  if (!res.ok) throw new Error(`Failed to fetch event page (HTTP ${res.status})`);

  const html = await res.text();
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s
  );

  if (!match) throw new Error("Could not find __NEXT_DATA__ in page. Is this the right URL?");
  return JSON.parse(match[1]);
}

async function fetchResultsForEvent(eventUuid) {
  const url = `https://labs-v2.competitor.com/api/results?wtc_eventid=${eventUuid}`;
  console.log(`   Fetching results from API...`);

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });

  if (!res.ok) throw new Error(`API request failed (HTTP ${res.status})`);

  const data = await res.json();
  if (data?.resultsJson?.value) return data.resultsJson.value;

  throw new Error('API response missing "resultsJson.value"');
}

function convertToCSV(data) {
  const headers = [
    "Bib Number", "Athlete Name", "Gender", "City", "State", "Country",
    "Division", "Status", "Finish Time", "Swim Time", "T1 Time", "Bike Time",
    "T2 Time", "Run Time", "Overall Rank", "Gender Rank", "Division Rank",
    "AWA Points", "Swim Rank (Overall)", "Swim Rank (Gender)", "Swim Rank (Division)",
    "Bike Rank (Overall)", "Bike Rank (Gender)", "Bike Rank (Division)",
    "Run Rank (Overall)", "Run Rank (Gender)", "Run Rank (Division)",
    "Finish (Seconds)", "Swim (Seconds)", "T1 (Seconds)", "Bike (Seconds)",
    "T2 (Seconds)", "Run (Seconds)",
    // Gun time = clock time from official race start (chip time + wave start offset).
    // Used for physical passing calculations. Empty if not provided by the API.
    "Finish Gun Time", "Finish Gun (Seconds)",
  ];

  const rows = data.map((r) => ({
    "Bib Number": r.bib,
    "Athlete Name": r.athlete,
    Gender: r.wtc_ContactId?.gendercode_formatted || "",
    City: r.wtc_ContactId?.address1_city || "",
    State: r.wtc_ContactId?.address1_stateorprovince || "",
    Country: r.countryiso2,
    Division: r.wtc_AgeGroupId?.wtc_agegroupname || r.wtc_DivisionId?.wtc_name || "",
    Status: r.wtc_dnf ? "DNF" : r.wtc_dq ? "DQ" : "FIN",
    "Finish Time": r.wtc_finishtimeformatted,
    "Swim Time": r.wtc_swimtimeformatted,
    "T1 Time": r.wtc_transition1timeformatted,
    "Bike Time": r.wtc_biketimeformatted,
    "T2 Time": r.wtc_transitiontime2formatted,
    "Run Time": r.wtc_runtimeformatted,
    "Overall Rank": r.wtc_finishrankoverall,
    "Gender Rank": r.wtc_finishrankgender,
    "Division Rank": r.wtc_finishrankgroup,
    "AWA Points": r.wtc_points,
    "Swim Rank (Overall)": r.wtc_swimrankoverall,
    "Swim Rank (Gender)": r.wtc_swimrankgender,
    "Swim Rank (Division)": r.wtc_swimrankgroup,
    "Bike Rank (Overall)": r.wtc_bikerankoverall,
    "Bike Rank (Gender)": r.wtc_bikerankgender,
    "Bike Rank (Division)": r.wtc_bikerankgroup,
    "Run Rank (Overall)": r.wtc_runrankoverall,
    "Run Rank (Gender)": r.wtc_runrankgender,
    "Run Rank (Division)": r.wtc_runrankgroup,
    "Finish (Seconds)": r.wtc_finishtime,
    "Swim (Seconds)": r.wtc_swimtime,
    "T1 (Seconds)": r.wtc_transition1time,
    "Bike (Seconds)": r.wtc_biketime,
    "T2 (Seconds)": r.wtc_transition2time,
    "Run (Seconds)": r.wtc_runtime,
    // Gun time fields — populated if the API provides them, empty otherwise.
    // wtc_finishguntime / wtc_finishtimegunformatted are the typical field names
    // in the competitor.com API. If blank after a fetch, the race may not publish
    // gun times and wave offsets will need to be supplied another way.
    "Finish Gun Time":     r.wtc_finishtimegunformatted || r.wtc_finishguntimeformatted || "",
    "Finish Gun (Seconds)": r.wtc_finishguntime ?? "",
  }));

  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const headerRow = headers.join(",");
  const dataRows = rows.map((row) => headers.map((h) => escape(row[h])).join(","));
  return [headerRow, ...dataRows].join("\n");
}

function getYearFromName(name) {
  const m = (name || "").match(/\b(20\d{2})\b/);
  return m ? m[1] : null;
}

// ─── Debug helpers ────────────────────────────────────────────────────────────

/** Flatten a nested object into dot-notation keys (e.g. "wtc_ContactId.address1_city") */
function collectKeys(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...collectKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

function getNestedValue(obj, dotPath) {
  return dotPath.split(".").reduce((o, k) => o?.[k], obj);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2).filter((a) => !a.startsWith("--") || a === "--dump-fields");
const [eventUrl, targetYear, outputDir = path.join(__dirname, "data")] = rawArgs;

// --event-name <substring>: filter to events whose name contains this string
// (case-insensitive). Useful when an /odiv/ URL returns a multi-race group.
const eventNameIdx = process.argv.indexOf("--event-name");
const eventNameFilter = eventNameIdx !== -1
  ? process.argv[eventNameIdx + 1]?.toLowerCase()
  : null;

if (!eventUrl || !eventUrl.startsWith("http")) {
  console.error(`
Usage: node scripts/fetch-race.mjs <event-group-url> [year] [output-dir]
                                    [--event-name <substring>] [--dump-fields]

  event-group-url    labs-v2.competitor.com/results/event/UUID
  year               Optional — only download this year (e.g. 2026). Defaults to most recent.
  output-dir         Where to write CSVs. Defaults to scripts/data/
  --event-name       Filter to events whose name contains this string (case-insensitive).
                     Useful when a /odiv/ URL returns results across multiple races.
  --dump-fields      Print all raw API field names from the first record and exit.

How to find the event-group-url:
  1. Go to the race results page on ironman.com
  2. View Page Source and search for "labs-v2.competitor.com"
  3. Copy the URL that looks like:
     https://labs-v2.competitor.com/results/event/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

Example:
  node scripts/fetch-race.mjs https://labs-v2.competitor.com/results/event/odiv/UUID 2025 \\
    --event-name "Oceanside"
`);
  process.exit(1);
}

(async () => {
  try {
    await fs.mkdir(outputDir, { recursive: true });

    const jsonData = await fetchNextData(eventUrl);
    const subEvents = jsonData?.props?.pageProps?.subevents;

    if (!subEvents?.length) {
      throw new Error(
        'No "subevents" found in page data. Make sure you are using the event GROUP URL (the one with the year dropdown), not a single-year results page.'
      );
    }

    console.log(`\n📋 Found ${subEvents.length} year(s) available`);

    // Sort by year descending so we default to most recent
    const sorted = subEvents
      .map((e) => ({ ...e, year: getYearFromName(e.wtc_name || e.wtc_externaleventname) }))
      .filter((e) => e.year && e.wtc_eventid)
      .sort((a, b) => b.year - a.year);

    if (!sorted.length) throw new Error("Could not find any events with a valid year and UUID.");

    // Apply --event-name filter before year selection
    const nameFiltered = eventNameFilter
      ? sorted.filter((e) => {
          const name = (e.wtc_name || e.wtc_externaleventname || "").toLowerCase();
          return name.includes(eventNameFilter);
        })
      : sorted;

    if (eventNameFilter && !nameFiltered.length) {
      throw new Error(
        `No events found matching --event-name "${eventNameFilter}".\n` +
        `Available events:\n` +
        sorted.map((e) => `  • ${e.wtc_name || e.wtc_externaleventname} (${e.year})`).join("\n")
      );
    }

    const toFetch = targetYear
      ? nameFiltered.filter((e) => e.year === targetYear)
      : [nameFiltered[0]]; // default: most recent matching event

    if (!toFetch.length) {
      const available = nameFiltered.map((e) => e.year).join(", ");
      throw new Error(`No event found for year ${targetYear}. Available: ${available}`);
    }

    for (const event of toFetch) {
      console.log(`\n🏊 Processing ${event.year}...`);
      const results = await fetchResultsForEvent(event.wtc_eventid);

      if (!results?.length) {
        console.warn(`   ⚠️  No results returned for ${event.year}`);
        continue;
      }

      // --dump-fields: print every field name (and its value) from the first
      // record, then exit. Useful for discovering what the API actually returns.
      if (process.argv.includes("--dump-fields")) {
        console.log(`\n🔍 Raw fields on first record (${results[0].bib} — ${results[0].athlete}):\n`);
        const rec = results[0];
        const allKeys = collectKeys(rec);
        for (const key of allKeys.sort()) {
          const val = getNestedValue(rec, key);
          if (val !== undefined && val !== null && val !== "") {
            console.log(`  ${key.padEnd(55)} ${JSON.stringify(val)}`);
          }
        }
        console.log(`\n  (${allKeys.length} total fields — blanks hidden)\n`);
        process.exit(0);
      }

      const csv = convertToCSV(results);
      const eventName = (eventUrl.split("/").pop() || "race")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "_");
      const filename = path.join(outputDir, `${eventName}_${event.year}.csv`);

      await fs.writeFile(filename, csv);

      const finishers = results.filter((r) => !r.wtc_dnf && !r.wtc_dq).length;
      const dnfs = results.filter((r) => r.wtc_dnf).length;
      console.log(`   ✅ ${results.length} athletes → ${filename}`);
      console.log(`   📊 Finishers: ${finishers} | DNF: ${dnfs}`);
    }

    console.log("\n✅ Done. Run analyze-passing.mjs to see the passing analysis.\n");
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    process.exit(1);
  }
})();
