# Race Replay — Scraper

Standalone scripts to fetch race data from RTRT.me, inspect timing point structure,
and run the leg-by-leg physical passing algorithm.

Run these locally before ingesting data into the database.

---

## Scripts

| Script               | Purpose                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| `racereplay.mjs`     | Fetch splits from RTRT.me, run passing algorithm, write `_passing.csv`       |
| `check-legs.mjs`     | Preview timing points and segment names for an event before scraping         |
| `test-algorithm.mjs` | Unit tests for the passing algorithm — run before trusting a new race output |

---

## Typical workflow

### Step 1 — Find the RTRT event ID and app ID

1. Go to **https://track.rtrt.me** and find the race
2. The URL will be `https://track.rtrt.me/e/<EVENT-ID>` — the last segment is the event ID
3. Find the app ID: view page source (`Cmd+U`) and search for `"appid"`:
   ```json
   "appid":"<id>"
   ```
   The app ID is required for every run — it is not stored in the source code.

### Step 2 — Check the legs before scraping

Always run `check-legs.mjs` first to confirm the timing point structure matches
what you expect. This is especially important for older events that may have
extra intermediate checkpoints that need to be collapsed.

```bash
node scraper/check-legs.mjs <event-id> [--appid <id>]
```

Examples:

```bash
node scraper/check-legs.mjs <event-id> --appid <id>
```

Output shows every timing point — its raw name, label, cleaned leg name, and km
position — and which will be used vs. excluded. The **Final leg names** line at
the bottom is what gets stored in the database.

**Canonical legs for IRONMAN triathlons:** `Swim, T1, Bike, T2, Run`

If you see extra intermediate run splits (e.g. `Run 1.7mi, Run 14.8mi`) that
means the event has additional published checkpoints. Use the `--points` flag
in step 3 to force only the canonical checkpoints.

### Step 3 — Run the scraper

```bash
node scraper/racereplay.mjs <event-id> [--appid <id>] [--points A,B,C,D,E,F]
```

Examples:

```bash
# Standard run
node scraper/racereplay.mjs <event-id> --appid <id>

# Force canonical checkpoints (use when check-legs shows extra splits)
node scraper/racereplay.mjs <event-id> --appid <id> --points START,SWIM,T1,BIKE,T2,FINISH
```

**All flags:**

```
--appid <id>          RTRT tracker app ID. Required.
--points A,B,C        Force specific timing points — use to collapse extra splits
--output-dir <dir>    Write output here (default: scraper/data/)
--concurrency <n>     Parallel point fetches (default: 4)
--fresh               Ignore cached split files and re-fetch everything
--verify              Re-run algorithm on existing cache without re-fetching
```

**Output:** `scraper/data/<EVENT-ID>_passing.csv`

**Timing:** ~300ms/page + 5s between timing points. A 24K-athlete event with
3 timing points takes ~18 minutes.

### Step 4 — Ingest into the database

```bash
cd app
npx tsx scripts/ingest.ts ../scraper/data/<EVENT-ID>_passing.csv \
  --slug <slug> \
  --race-name "<Race Name>" \
  --year <YYYY> \
  --event-type <triathlon|road_race> \
  --event-date <YYYY-MM-DD>
```

Race metadata (location, country, distanceType, seriesName, website) and
segment name normalization (`FINISH → Run`) are loaded automatically from
`app/scripts/races.config.json` when the slug is recognized.

Add `--dry-run` to validate columns and preview segment names without writing:

```bash
npx tsx scripts/ingest.ts ../scraper/data/<EVENT-ID>_passing.csv \
  --dry-run --slug <slug>
```

---

## Segment name normalization

The scraper outputs the raw RTRT timing point names as column headers
(e.g. `FINISH Time`). The ingest script renames these to canonical names
before storing them in the database.

Current mapping for all IRONMAN events (defined in `app/scripts/races.config.json`):

| CSV column | Stored as |
|------------|-----------|
| SWIM       | Swim      |
| T1         | T1        |
| BIKE       | Bike      |
| T2         | T2        |
| FINISH     | Run       |

This ensures all years of the same race use consistent segment names even
when RTRT adds or removes intermediate checkpoints year to year.

---

## Known event IDs

| Race                     | Year | Event ID                   | Notes                               |
| ------------------------ | ---- | -------------------------- | ----------------------------------- |
| IM Wisconsin             | 2022 | IRM-WISCONSIN-2022         | Use `--points START,SWIM,T1,BIKE,T2,FINISH` |
| IM Wisconsin             | 2023 | IRM-WISCONSIN-2023         |                                     |
| IM Wisconsin             | 2024 | IRM-WISCONSIN-2024         |                                     |
| IM 70.3 Chattanooga      | 2026 | IRM-CHATTANOOGA703-2026    |                                     |
| IM 70.3 Oceanside        | 2025 | IRM-OCEANSIDE703-2025      |                                     |
| IM 70.3 Oceanside        | 2026 | IRM-OCEANSIDE703-2026      |                                     |
| BofA Shamrock Shuffle    | 2026 | BASS2026                   | Uses a different app ID             |

---

## How physical passing works

In a time-trial (TT) start race, athletes enter one at a time. A "physical
pass" requires knowing who was actually ahead on course — which requires each
athlete's individual start time.

Race Replay uses per-athlete start epoch times from RTRT.me to compute the
absolute clock time each athlete was at every checkpoint. Comparing two
athletes' absolute checkpoint times directly answers "who was physically ahead?"

**Key identity:**

```
epochTime[any_point] = startEpoch + chipSplitSeconds
```

**Swim leg:** Uses `startEpoch` as the "before" position and
`startEpoch + swimSecs` as the "after" — the same before→after comparison
used by every other leg.

---

## Unit tests

```bash
node scraper/test-algorithm.mjs
```

21 assertions on a hand-crafted 6-athlete dataset including DNF handling.
Run this before trusting output from a new race.

---

## Verified results

### 2026 Bank of America Shamrock Shuffle (BASS2026)

24,216 athletes · 24,152 finishers · 64 DNFs · 2 legs (5K, Finish)

- 5K: gained = lost = 8,805,358 ✅
- Finish: gained = lost = 7,864,006 ✅

### 2026 IM 70.3 Oceanside (IRM-OCEANSIDE703-2026)

3,171 athletes · 2,973 finishers · 198 DNFs · 3,170 RTRT start times matched

All 5 leg invariants pass.

### 2025 IM 70.3 Oceanside

2,962 athletes · 2,540 finishers · 196 DNFs · 2,564 RTRT start times matched

All 5 leg invariants pass.

### 2025 IM 70.3 Rockford

2,071 athletes · 1,821 finishers · 249 DNFs · 2,004 RTRT start times matched

All 5 leg invariants pass. Cross-checked Tom Arra (bib 361, overall 751st):

| Leg             | Reference | Algorithm | Delta    |
| --------------- | --------- | --------- | -------- |
| Swim passed     | 70        | 76        | +6       |
| Swim got passed | 12        | 11        | -1       |
| Bike passed     | 140       | 137       | -3       |
| Bike got passed | 65        | 66        | +1       |
| Run passed      | 19        | 19        | ✅ exact |
| Run got passed  | 196       | 184       | -12      |

Remaining delta explained by ~67 athletes present in one dataset but not the
other (97% match rate).
