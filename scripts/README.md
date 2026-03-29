# RaceReplay — Data Pipeline & POC Scripts

Standalone scripts to fetch real Ironman race data and run the leg-by-leg
physical passing algorithm. Built as a proof-of-concept before the full app.

---

## Data sources

Two completely separate systems provide the data we need.

### competitor.com (post-race results)
`labs-v2.competitor.com` — backed by Microsoft Dynamics 365 CRM. Provides
chip-elapsed split times (swim, T1, bike, T2, run, finish) for every athlete,
plus rankings and profile data. **Does not provide gun times or individual
start times.**

### RTRT.me (live tracking)
`api.rtrt.me` — the backend behind the official IRONMAN Tracker mobile app.
Records a precise Unix epoch timestamp (`epochTime`) when each athlete crosses
every timing mat, including the **start mat**. This is the only source for
per-athlete start times in TT-start races.

| | competitor.com | RTRT.me |
|---|---|---|
| Chip split times | ✅ | ✅ (`netTime`) |
| Individual start time | ❌ | ✅ (`epochTime` at START) |
| Gun time at each split | ❌ | ✅ (compute as `startEpoch + netTime`) |
| Post-race availability | ✅ permanent | ✅ (retained after race) |

---

## How physical passing works

In a time-trial (TT) start race, athletes enter the water one by one. A
"physical pass" requires knowing who was actually ahead on course — which
requires each athlete's individual start time.

**Key identity (verified):**
```
epochTime[any_point] = startEpoch + chipSplitSeconds
```

So once we have `startEpoch` per athlete from RTRT, we can compute the
absolute clock time each athlete was at every checkpoint. Comparing two
athletes' absolute checkpoint times directly answers "who was physically
ahead?"

**Swim leg note:** The swim uses `startEpoch` as the "before" position (who
was already in the water ahead of you when you entered) and `startEpoch +
swimSecs` as the "after" position (who exited first). This is the same
before→after comparison used by every other leg. Without RTRT data
(simultaneous gun start), the swim falls back to pure chip-swim-rank
comparison.

---

## Prerequisites

Node.js 18+ (native `fetch`). No dependencies to install.

---

## Step 1 — Find the competitor.com event URL

1. Go to the race results page on **ironman.com**
   e.g. `https://www.ironman.com/im703-oceanside-results`
2. View page source (`Cmd+U`) and search for `competitor.com`
3. Copy the URL:
   ```
   https://labs-v2.competitor.com/results/event/4798aa20-f278-e111-b16a-005056956277
   ```

> **Note:** Some URLs contain `/odiv/` and return results across multiple
> races. Use `--event-name` to filter to a specific race.

---

## Step 2 — Fetch the results CSV

```bash
node scripts/fetch-race.mjs <competitor-url> <year>
```

Example:
```bash
node scripts/fetch-race.mjs \
  https://labs-v2.competitor.com/results/event/4798aa20-f278-e111-b16a-005056956277 \
  2025
```

Writes to `scripts/data/`. The CSV has 35 columns including pre-computed
seconds for every split.

**Flags:**
```bash
# If the URL returns multiple races, filter by name:
--event-name "Oceanside"

# Print every raw API field from the first record and exit (diagnostics):
--dump-fields
# (scans ALL records — not just the first — so fields that are 0 for the
#  winner but non-zero for other athletes are still surfaced)
```

---

## Step 3 — Find the RTRT event ID

Go to **https://track.rtrt.me** and search for the race. The URL will be:
```
https://track.rtrt.me/e/IRM-OCEANSIDE703-2025
```
The segment after `/e/` is the RTRT event ID. Common patterns:
- `IRM-<RACENAME>703-<YEAR>` — 70.3 races (e.g. `IRM-ROCKFORD703-2025`)
- `IRM-<RACENAME>-<YEAR>` — full-distance races (e.g. `IRM-FLORIDA-2025`)

---

## Step 4 — Fetch per-athlete start times

```bash
node scripts/fetch-rtrt-starts.mjs <rtrt-event-id>
```

Example:
```bash
node scripts/fetch-rtrt-starts.mjs IRM-OCEANSIDE703-2025
```

- Registers with `api.rtrt.me` using the IRONMAN Tracker app ID
- Paginates through all START splits (20/page, ~130 requests for 2,500 athletes)
- Writes `scripts/data/<event-id>_starts.csv` with `Bib, StartEpoch, StartTimeOfDay`
- Takes ~2–3 minutes

---

## Step 5 — Run the passing analysis

```bash
node scripts/analyze-passing.mjs <results-csv> --rtrt-starts <starts-csv>
```

Example:
```bash
node scripts/analyze-passing.mjs \
  scripts/data/4798aa20_f278_e111_b16a_005056956277_2025.csv \
  --rtrt-starts scripts/data/irm-oceanside703-2025_starts.csv
```

**Without RTRT data** (falls back to chip-time-only mode):
```bash
node scripts/analyze-passing.mjs scripts/data/<file>.csv
```

**With wave offsets instead of RTRT** (wave-start races):
```bash
node scripts/analyze-passing.mjs scripts/data/<file>.csv \
  --wave-offsets scripts/data/<file>_waves.json
# See scripts/data/wave-offsets-example.json for the format
```

**Output:**
- Terminal report: invariant check, top 5 finishers, biggest climbers/fallers
- `<input>_passing.csv`: full per-athlete breakdown written alongside input file

---

## Step 6 — Run algorithm unit tests

```bash
node scripts/test-algorithm.mjs
```

21 assertions on a hand-crafted 6-athlete dataset including DNF handling.
All must pass before trusting real-race output.

---

## Scripts summary

| Script | Purpose |
|---|---|
| `fetch-race.mjs` | Fetches results CSV from competitor.com |
| `fetch-rtrt-starts.mjs` | Fetches per-athlete start epoch times from RTRT.me |
| `analyze-passing.mjs` | Runs the passing algorithm, prints report, writes passing CSV |
| `test-algorithm.mjs` | Unit tests for the passing algorithm |
| `data/wave-offsets-example.json` | Template for wave-start offset files |

---

## Verified results

### 2025 IM 70.3 Oceanside
2,962 athletes · 2,540 finishers · 196 DNFs · 2,564 RTRT start times matched

All 5 leg invariants pass. Lionel Sanders (overall winner) shows +2,603 net
with the dominant story in the swim.

### 2025 IM 70.3 Rockford
2,071 athletes · 1,821 finishers · 249 DNFs · 2,004 RTRT start times matched

All 5 leg invariants pass. Cross-checked Tom Arra (bib 361, overall 751st)
against a known-good reference:

| Leg | Reference | Algorithm | Delta |
|-----|-----------|-----------|-------|
| Swim passed | 70 | 76 | +6 (~3% gap from unmatched athletes) |
| Swim got passed | 12 | 11 | -1 |
| Bike passed | 140 | 137 | -3 |
| Bike got passed | 65 | 66 | +1 |
| Run passed | 19 | 19 | ✅ exact |
| Run got passed | 196 | 184 | -12 |

Remaining delta is fully explained by the ~67 athletes present in one
dataset but not the other (97% match rate).
