# RaceReplay — Data Pipeline Scripts

Standalone scripts to fetch race data from RTRT.me and run the leg-by-leg
physical passing algorithm.

---

## How physical passing works

In a time-trial (TT) start race, athletes enter one at a time. A "physical
pass" requires knowing who was actually ahead on course — which requires each
athlete's individual start time.

RaceReplay uses per-athlete start epoch times from RTRT.me to compute the
absolute clock time each athlete was at every checkpoint. Comparing two
athletes' absolute checkpoint times directly answers "who was physically ahead?"

**Key identity:**
```
epochTime[any_point] = startEpoch + chipSplitSeconds
```

**Swim leg note:** The swim uses `startEpoch` as the "before" position and
`startEpoch + swimSecs` as the "after" position — the same before→after
comparison used by every other leg.

---

## Prerequisites

Node.js 18+ (native `fetch`). No dependencies to install.

---

## Workflow — Fetch and analyze any RTRT-tracked race

### Step 1 — Find the RTRT event ID and app ID

1. Go to **https://track.rtrt.me** and search for the race
2. The URL will be `https://track.rtrt.me/e/<EVENT-ID>` — that segment is the event ID
3. View the page source (`Cmd+U`) and search for `"appid"` — you'll find something like:
   ```json
   "appid":"4d9df5bf9f36bc4a1dc8fce2"
   ```
   Each race organizer has their own app ID. The IRONMAN Tracker default is
   `5824c5c948fd08c23a8b4567` (no need to pass `--appid` for IRM-* events).

### Step 2 — Fetch splits

```bash
node scripts/fetch-rtrt-event.mjs <event-id> [--appid <id>]
```

Examples:
```bash
# Bank of America Shamrock Shuffle (non-IRONMAN, requires --appid)
node scripts/fetch-rtrt-event.mjs BASS2026 --appid 4d9df5bf9f36bc4a1dc8fce2

# Any IRONMAN event (uses default IRONMAN app ID)
node scripts/fetch-rtrt-event.mjs IRM-OCEANSIDE703-2026
```

**Flags:**
```
--appid <id>          RTRT tracker app ID (default: IRONMAN app ID)
--output-dir <dir>    Write files here (default: scripts/data/)
--points A,B,C        Manual timing point override — skip auto-discovery
```

**Flags for analyze-passing.mjs:**
```
--rtrt-starts <file>   Per-athlete start times (_starts.csv)
--wave-offsets <file>  Per-division wave offsets in seconds (JSON) — fallback
```

**Output:**
- `scripts/data/<EVENT-ID>.csv` — full results with leg columns named after timing segments
- `scripts/data/<event-id>_starts.csv` — per-athlete start epoch times

**Timing:** ~300ms/page + 5s between points. A 24K-athlete event with 3 timing
points takes ~18 minutes.

### Step 3 — Run the passing analysis

```bash
node scripts/analyze-passing.mjs scripts/data/<EVENT-ID>.csv \
  --rtrt-starts scripts/data/<event-id>_starts.csv
```

Any column ending in ` (Seconds)` (except Finish, Finish Gun, Wave Offset) is
treated as a leg automatically — no configuration needed.

**Output:**
- Terminal report: invariant check, top finishers, biggest climbers/fallers
- `scripts/data/<EVENT-ID>_passing.csv` — full per-athlete breakdown, ready to ingest

### Step 4 — Ingest into the database

```bash
cd app
npx tsx scripts/ingest.ts ../scripts/data/<EVENT-ID>_passing.csv \
  --slug <slug> \
  --race-name "<Race Name>" \
  --year <YYYY> \
  --event-type <triathlon|road_race> \
  --event-date <YYYY-MM-DD>
```

---

## Unit tests

```bash
node scripts/test-algorithm.mjs
```

21 assertions on a hand-crafted 6-athlete dataset including DNF handling.
Run this before trusting output from a new race.

---

## Scripts summary

| Script | Purpose |
|---|---|
| `fetch-rtrt-event.mjs` | Fetches splits and start times from RTRT.me for any race type |
| `analyze-passing.mjs` | Runs the passing algorithm, prints report, writes `_passing.csv` |
| `test-algorithm.mjs` | Unit tests for the passing algorithm |

---

## Verified results

### 2026 Bank of America Shamrock Shuffle (BASS2026)

24,216 athletes · 24,152 finishers · 64 DNFs · 2 legs (5K, Finish)

Both leg invariants pass:
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

| Leg | Reference | Algorithm | Delta |
|---|---|---|---|
| Swim passed | 70 | 76 | +6 |
| Swim got passed | 12 | 11 | -1 |
| Bike passed | 140 | 137 | -3 |
| Bike got passed | 65 | 66 | +1 |
| Run passed | 19 | 19 | ✅ exact |
| Run got passed | 196 | 184 | -12 |

Remaining delta explained by ~67 athletes present in one dataset but not the
other (97% match rate).
