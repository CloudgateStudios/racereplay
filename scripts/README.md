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
   Copy that full URL.

---

## Step 2 — Fetch the race data

```bash
node scripts/fetch-race.mjs <event-group-url> 2026
```

Example:
```bash
node scripts/fetch-race.mjs https://labs-v2.competitor.com/results/event/abc-123-def 2026
```

This will write the CSV to `scripts/data/` (e.g. `scripts/data/abc-123-def_2026.csv`).

The CSV contains 33 columns including pre-computed seconds for every split —
no further time parsing needed.

---

## Step 3 — Run the passing analysis

```bash
node scripts/analyze-passing.mjs scripts/data/<filename>.csv
```

Example:
```bash
node scripts/analyze-passing.mjs scripts/data/abc-123-def_2026.csv
```

Output includes:
- **Invariant check** — sum(gained) must equal sum(lost) per leg
- **Top 5 finishers** — leg-by-leg passing breakdown
- **Biggest climbers** — top 10 athletes by net positions gained
- **Biggest fallers** — bottom 10 by net positions lost

---

## Step 4 — Run algorithm unit tests (optional)

```bash
node scripts/test-algorithm.mjs
```

Runs 21 assertions against a hand-crafted 6-athlete dataset including DNF handling.
All must pass before trusting the real race output.
