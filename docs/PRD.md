# RaceTrace — Product Requirements Document

**Version:** 1.0
**Last Updated:** 2026-03-29

---

## Problem

Endurance race results (Ironman triathlon, marathon, cycling) are published as flat finish-line tables. They tell you _what_ your final rank was, but not _how_ you got there. Athletes, coaches, and fans have no easy way to answer:

- "Did I lose most of my ground on the bike or the run?"
- "Who specifically ran past me in the final 10k?"
- "How many people did I pass in T1 compared to other fast transitioners?"

---

## Solution

RaceTrace ingests full race results (all split times for all athletes) and computes, for each athlete, a leg-by-leg passing analysis:

- How many athletes they passed during each segment
- How many athletes passed them during each segment
- The specific names and bibs of those athletes

Data is loaded once by an admin (CSV upload), then the app is read-only and fully public.

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
| Admin CSV upload | Protected upload form; import pipeline with validation |
| Multi-race support | New races can be added at any time; each has its own slug |

### Post-MVP (future)

| Feature | Notes |
|---|---|
| Division-filtered passing | "How many in your age group passed you during the bike?" |
| Field-wide heatmaps | Visual showing where in the field bulk passing happened |
| Head-to-head comparison | Pick two athletes and compare their leg-by-leg trajectories |
| Race series tracking | Same athlete across multiple races over time |
| Athlinks import | Automated pull via Athlinks API instead of manual CSV |
| Shareable athlete cards | OG image + shareable URL for social media |

---

## Non-Goals

- No user accounts, logins, or profiles
- No real-time data (races are static once uploaded)
- No athlete-submitted corrections
- Not limited to Ironman — any timed race with swim/T1/bike/T2/run splits qualifies (or any multi-leg race format with configurable legs in future)

---

## Race Format Support

**MVP:** Full-distance and 70.3 Ironman triathlon (swim + T1 + bike + T2 + run)

**Future:** Other multi-leg race formats (duathlon, aquabike, marathon, cycling stage races) via configurable leg definitions.

---

## Data Ingestion

No official Ironman API exists. CSV export is the primary mechanism.

**Recommended CSV source:**
1. Export from [ironman.com](https://www.ironman.com) results page manually
2. Use the Node.js scraper: [github.com/colinlord/ironman-results](https://github.com/colinlord/ironman-results) (zero-dependency, exports 30+ column CSV)
3. Export from [athlinks.com](https://www.athlinks.com) (aggregates Ironman results)

**Expected columns:** `Pos, Bib, Name, Country, Division, Swim, T1, Bike, T2, Run, Finish, Points`
Times in `HH:MM:SS` format. The import parser normalises to integer seconds.

The column mapper is flexible — header names are mapped by case-insensitive fuzzy match, so minor variation between race exports is handled automatically.

---

## Success Metrics

- Any uploaded race CSV imports cleanly and passing stats are correct (verifiable against raw split ranks)
- Athlete search returns results in <200ms
- Passing analysis page loads in <500ms
- Admin can upload a 3000-athlete CSV and have it fully processed in <30 seconds
