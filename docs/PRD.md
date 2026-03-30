# RaceReplay — Product Requirements Document

**Version:** 1.1
**Last Updated:** 2026-03-30

---

## Problem

Endurance race results (Ironman triathlon, marathon, cycling) are published as flat finish-line tables. They tell you _what_ your final rank was, but not _how_ you got there. Athletes, coaches, and fans have no easy way to answer:

- "Did I lose most of my ground on the bike or the run?"
- "Who specifically ran past me in the final 10k?"
- "How many people did I pass in T1 compared to other fast transitioners?"

---

## Solution

RaceReplay ingests full race results (all split times for all athletes) and computes, for each athlete, a leg-by-leg passing analysis:

- How many athletes they passed during each segment
- How many athletes passed them during each segment
- The specific names and bibs of those athletes

Data is loaded once by an admin (via the import pipeline), then the app is read-only and fully public.

---

## Target Users

1. **Athletes** — want to understand where they gained or lost positions in a race they competed in
2. **Coaches** — analysing an athlete's relative performance across segments
3. **Fans / spectators** — curious about field movement dynamics in a major race

No account required. The service is entirely public.

---

## Feature Scope

### MVP (Phase 1–3)

| Feature | Description |
|---|---|
| Race library | Home page listing all uploaded races with metadata |
| Athlete search | Debounced search by name or bib number within a race |
| Athlete results view | Full split times + official rankings for one athlete |
| Passing analysis | Per-leg breakdown: positions gained/lost + who specifically |
| Overall summary | Net position change across the full race |
| Admin import pipeline | Protected admin UI; imports race data from RTRT.me + competitor.com |
| Multi-race support | New races can be added at any time; each has its own slug |

### Post-MVP (future)

| Feature | Notes |
|---|---|
| Division-filtered passing | "How many in your age group passed you during the bike?" |
| Field-wide heatmaps | Visual showing where in the field bulk passing happened |
| Head-to-head comparison | Pick two athletes and compare their leg-by-leg trajectories |
| Race series tracking | Same athlete across multiple races over time |
| Shareable athlete cards | OG image + shareable URL for social media |

---

## Non-Goals

- No user accounts, logins, or profiles
- No real-time data (races are static once imported)
- No athlete-submitted corrections
- Not limited to Ironman — any timed race with swim/T1/bike/T2/run splits qualifies (or any multi-leg race format with configurable legs in future)

---

## Race Format Support

**MVP:** Full-distance and 70.3 Ironman triathlon (swim + T1 + bike + T2 + run)

**Future:** Other multi-leg race formats (duathlon, aquabike, marathon, cycling stage races) via configurable leg definitions.

---

## Data Ingestion

Ironman race data comes from two separate systems that together provide everything the passing algorithm needs.

### Source 1 — competitor.com (chip split times)

`labs-v2.competitor.com` is the public-facing results site backed by Microsoft Dynamics 365 CRM. It provides chip-elapsed split times (swim, T1, bike, T2, run, finish) for every athlete, official rankings, and athlete profile data.

**Does not provide:** gun times, wave start offsets, or per-athlete start times of any kind. This was confirmed by scanning all API fields across a full race field (2,071 athletes). The field simply does not exist in the API response.

### Source 2 — RTRT.me (per-athlete start times)

`api.rtrt.me` is the backend behind the official IRONMAN Tracker mobile app. It records a precise Unix epoch timestamp (`epochTime`) when each athlete crosses every timing mat, including the **start mat**.

**Why start times matter:** In a time-trial (TT) start race, athletes enter the water individually over a 30–60 minute window. Two athletes with the same chip-swim-time could have started 5 minutes apart — without knowing who started first, you cannot tell who was physically ahead. RTRT's epoch timestamps resolve this exactly:

```
epochTime[any_point] = startEpoch + chipSplitSeconds
```

Comparing two athletes' `epochTime` at any checkpoint directly answers "who was physically ahead?"

### Passing modes

| Mode | When used | Swim handling | All other legs |
|---|---|---|---|
| **Physical passing** | RTRT start times available (all modern TT-start Ironman races) | `waveOffset` as before position → swim exit as after | Physical position before → after each leg |
| **Chip-only** | No start time data | All start together → swim exit chip rank | Cumulative chip time before → after each leg |

Physical passing is always preferred. Chip-only is a correct fallback for traditional gun-start races or when RTRT data is unavailable.

### When data is available

RTRT.me retains data after the race and is typically available within hours. competitor.com results are often published 1–3 days after the race. For fresh races, RTRT alone is sufficient to build complete split data and run the full passing analysis.

---

## Success Metrics

- Any imported race has correct passing stats (verified via invariant: sum of gained = sum of lost per leg across all athletes)
- Athlete search returns results in <200ms
- Passing analysis page loads in <500ms
- Admin can import a 3000-athlete race and have it fully processed in <10 minutes
