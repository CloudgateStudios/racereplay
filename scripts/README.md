# RaceReplay — Proof of Concept Scripts

Two scripts to fetch real Ironman race data and verify the passing algorithm.

## Prerequisites

Node.js 18+ (uses native `fetch`). No dependencies to install.

---

## Step 1 — Find the event group URL

The fetch script needs the **event group URL** from `labs-v2.competitor.com`.

1. Open the Ironman results page in your browser:
   `https://www.ironman.com/im703-oceanside-results`

2. View the page source (`Cmd+U` on Mac) and search for `labs-v2.competitor.com`

3. You'll find an iframe src that looks like:
   ```
   https://labs-v2.competitor.com/results/event/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```
   Copy that full URL. Some events use an `/odiv/` path segment — that's fine too,
   but may return results from multiple races. Use `--event-name` to filter.

---

## Step 2 — Fetch the race data

```bash
node scripts/fetch-race.mjs <event-group-url> 2025
```

Example with a single-race URL:
```bash
node scripts/fetch-race.mjs https://labs-v2.competitor.com/results/event/abc-123-def 2025
```

Example with a multi-race `/odiv/` URL — filter by race name:
```bash
node scripts/fetch-race.mjs https://labs-v2.competitor.com/results/event/odiv/UUID 2025 \
  --event-name "Oceanside"
```

This writes the CSV to `scripts/data/` (e.g. `scripts/data/abc-123-def_2025.csv`).

**Troubleshooting / discovery:**

```bash
# Print every raw API field name + value from the first record, then exit.
# Use this to discover what the API actually returns for a given race.
node scripts/fetch-race.mjs <url> 2025 --dump-fields
```

---

## Step 3 — (Optional) Create a wave offsets file for physical passing

The competitor.com API does not publish gun times. Without wave offsets, the
passing analysis compares chip times only — accurate for same-wave athletes,
but incorrect across waves.

To enable **physical passing** (who was actually ahead on course):

1. Look up the wave start schedule in the race's Athlete Guide on ironman.com.

2. Copy `scripts/data/wave-offsets-example.json` and fill in the real times
   for your race. Each value is seconds after the official gun:
   ```json
   {
     "MPRO":   0,
     "FPRO":   180,
     "M30-34": 960,
     ...
   }
   ```
   Division names must **exactly** match the `Division` column in the CSV.

3. Save it as e.g. `scripts/data/oceanside_2025_waves.json`.

---

## Step 4 — Run the passing analysis

Without wave offsets (chip time only):
```bash
node scripts/analyze-passing.mjs scripts/data/<filename>.csv
```

With wave offsets (physical passing):
```bash
node scripts/analyze-passing.mjs scripts/data/<filename>.csv \
  --wave-offsets scripts/data/<filename>_waves.json
```

Output includes:
- **Mode** — confirms whether physical or chip-time mode is active
- **Invariant check** — sum(gained) must equal sum(lost) per leg
- **Top 5 finishers** — leg-by-leg passing breakdown
- **Biggest climbers** — top 10 athletes by net positions gained
- **Biggest fallers** — bottom 10 by net positions lost
- **`_passing.csv`** — full per-athlete breakdown written next to the input file

---

## Step 5 — Run algorithm unit tests (optional)

```bash
node scripts/test-algorithm.mjs
```

Runs 21 assertions against a hand-crafted 6-athlete dataset including DNF handling.
All must pass before trusting the real race output.
