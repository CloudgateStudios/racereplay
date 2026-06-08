# Race Replay — Planning & Ideation

This document consolidates tech debt, feature enhancements, and new feature ideas.
Items that require a database migration are flagged explicitly — those should be
designed and batched before large-scale data ingestion.

---

## 🗺 Order of Operations

### Phase 1 — Schema & tech debt
> Land all migrations before significant data ingestion. Backfill effort grows
> linearly with row count.

| # | Item | Description |
|---|------|-------------|
| 1 | T4 | Index on `normalizedName` — immediate, zero downtime |
| 2 | S1 | Race metadata fields (location, distanceType, seriesName) |
| 3 | T3 | `finishSeconds` on Athlete |
| 4 | S2 | Event denormalized counts (finisherCount, totalCount) |
| 5 | T2 | Gender normalization — audit existing values first, then migrate |
| 6 | T5 | Decide on `epochTime` — document or remove |
| 7 | T6 | Ingest reporting improvements |
| 8 | T1 | Country normalization (after S1 lands) |

### Phase 2 — Quick-win enhancements
> No schema changes needed. Can be built in any order.

| # | Item | Description |
|---|------|-------------|
| 9 | N3 | "Find me" name search UX on results page |
| 10 | E2 | Segment leaderboard on event page |
| 11 | E3 | Most passes in a single leg leaderboard |
| 12 | E1 | Year-over-year delta callout on athlete page (cleaner with T3 done) |
| 13 | E4 | OG image for athlete pages |
| 14 | E5 | Share improvements (tweet text, Web Share API) |

### Phase 3 — New features unlocked by Phase 1
> These depend on schema changes from Phase 1.

| # | Item | Description |
|---|------|-------------|
| 15 | N1 | Race search / discovery (needs S1) |
| 16 | N4 | Race series page (needs S1) |
| 17 | N6 | Race comparison, two events side-by-side |
| 18 | S3 | AthleteProfile model |
| 19 | N2 | Athlete cross-race profile page (needs S3) |
| 20 | N5 | Athlete personal bests (needs S3) |

### Phase 4 — Later / conditional
> Lower urgency or dependent on external factors.

| # | Item | Description |
|---|------|-------------|
| 21 | E8 | Admin ingest UI (useful once catalog is growing fast) |
| 22 | N7 | Embeddable widgets |
| 23 | S4 | Segment position snapshots (only if scraper produces the data) |

---

## Schema — Current State

```
Race          id, slug, name
Event         id, raceId, year, type, date
Segment       id, eventId, name, displayOrder, isFinish
Athlete       id, eventId, bib, name, normalizedName?, gender, division,
              country, city?, team?, status, finishTime?, waveTime?,
              overallRank?, genderRank?, divisionRank?
AthleteSegment  id, athleteId, segmentId, timeSeconds?, epochTime?,
                gained?, lost?, net?
CategoryResult  id, eventId, category, name, total
```

---

## 🔴 Pending Schema Changes

> These should be decided and migrated **before** heavy data ingestion.
> Each is a nullable addition (zero downtime), but the backfill effort
> grows linearly with row count.

### S1 — Race metadata (location, distance, description)

**Problem:** `Race` has only `slug` and `name`. No location, no distance class,
no description. Difficult to build a meaningful discovery/search experience
without at least location and race series info.

**Proposed additions to `Race`:**

```prisma
location     String?    // "Chattanooga, TN"
country      String?    // "US"
distanceType String?    // "70.3", "140.6", "5K", "Marathon", etc.
seriesName   String?    // "IRONMAN 70.3", "World Marathon Majors", etc.
website      String?    // canonical race URL
```

**Migration:** All nullable — zero downtime. Backfill by hand or from a config
file at ingest time. No script required if new races are populated at ingest.
Existing races need manual updates.

**Unlocks:** Race search/discovery (#5), better OG images, race cards.

---

### S2 — Event metadata (location override, participant count, weather)

**Problem:** `Event` has no description-level metadata. Hard to show "1,847
athletes finished" on the race card without querying `Athlete` every time.

**Proposed additions to `Event`:**

```prisma
finisherCount  Int?      // denormalized for fast display; set at ingest
totalCount     Int?      // all starters (FIN + DNF + DNS + DSQ)
locationNote   String?   // e.g. "Chattanooga, TN" if it differs from race
description    String?   // optional editorial blurb
```

**Migration:** All nullable. `finisherCount` and `totalCount` can be backfilled
with a one-off COUNT query per event. The rest are manual.

**Unlocks:** Richer race cards on home page, accurate "X athletes" without
a JOIN every render.

---

### S3 — Stable athlete identity (`AthleteProfile`)

**Problem:** `normalizedName` is a good matching key but it's still duplicated
across every event row. There's no canonical "person" record. This matters for:

- `/athletes/[id]` cross-race profile pages (item #6)
- Deduplication when the same athlete appears with slightly different spellings
- Future features like athlete-claimed profiles or opt-out

**Proposed new model:**

```prisma
model AthleteProfile {
  id             Int       @id @default(autoincrement())
  normalizedName String    @unique
  displayName    String    // canonical spelling, updated to latest ingest
  gender         String?
  country        String?
  appearances    Athlete[]
  createdAt      DateTime  @default(now())
}
```

Add `profileId Int?` → `AthleteProfile` FK on `Athlete`.

**Migration strategy:**

1. Add `AthleteProfile` table and nullable `profileId` on `Athlete` — zero downtime.
2. Run a one-off script that groups existing `Athlete` rows by `normalizedName`,
   creates one `AthleteProfile` per group, and writes `profileId` back to each row.
3. Update ingest to upsert the profile and set `profileId` on each new athlete row.

**Unlocks:** Item #6 (cross-race profile page), clean URL (`/athletes/[id]`),
future athlete search.

**Complexity:** Medium. The grouping script is ~50 lines; ingest change is small.

---

### S4 — Segment position snapshots (for replay/animation)

**Problem:** We currently store passing counts (gained/lost/net) but not the
underlying position-over-time data. If we ever want to animate a race or show
"your position at each checkpoint," we need position snapshots.

**Proposed addition to `AthleteSegment`:**

```prisma
positionAtCheckpoint  Int?   // overall position at this split
```

**Migration:** Nullable — zero downtime. Backfill is feasible if source data
has it; may not be derivable from current CSVs depending on source format.
Check whether the scraper produces it before committing.

**Unlocks:** Race replay animation, "you were Nth at the bike exit" callouts.

---

## 🟡 Feature Enhancements

> Improvements to existing functionality. No schema changes unless noted.

### E1 — Year-over-year delta callout on athlete page

Currently the Race History table shows raw numbers per year. Add computed
year-over-year delta rows or badges:

- Finish time: "18:22 faster than 2024"
- Overall rank: "↑56 places vs 2024"
- Net passes: "+13 more than 2024"

No schema change. Pure render logic.

---

### E2 — Segment leaderboard on event page (existing item #1)

"Best splits" view — fastest swim, fastest bike, fastest run — as a tab on
the event results page.

No schema change.

---

### E3 — "Most passes in a single leg" leaderboard

Companion to E2. A separate table showing the athletes with the highest
`gained` count on each segment — the people who made the most aggressive
moves on course.

No schema change.

---

### E4 — OG image for athlete pages

Currently athlete pages have no custom OG image — they inherit the root card.
A custom card showing the athlete name, race, year, finish time, and overall
rank would make shares much more compelling.

No schema change. New `opengraph-image.tsx` under `[bib]/`.

---

### E5 — Share improvements

The Share button currently copies the URL. Consider:

- Pre-formatted tweet text: "I passed 407 people at Ironman Wisconsin 2025 🏊‍♂️🚴‍♂️🏃‍♂️ #RaceReplay"
- Native share sheet on mobile (Web Share API)

No schema change.

---

### E8 — Admin ingest UI (existing item #7)

Password-protected browser-based CSV upload.

No schema change (needs env var `ADMIN_SECRET`).

---

## 🟢 New Features

> Net-new capabilities that don't exist today.

### N1 — Race search / discovery (existing item #5)

Search bar on home or dedicated `/search` page. Client-side filter over race
list works until ~500 races; Postgres full-text search after that.

**Schema dependency:** S1 (location, distanceType) makes search much more useful.

---

### N2 — Athlete cross-race profile page (existing item #6)

`/athletes/[id]` — all races an athlete has completed in the system, with
overall net passes, finish time, rank per event.

**Schema dependency:** S3 (`AthleteProfile`) required for a clean URL and
deduplication. Can be prototyped using `normalizedName` grouping without S3,
but S3 is the right foundation.

---

### N3 — "Find me" search on event results

A search-by-name shortcut on the race results page. Athlete types their name,
jumps straight to their result. Currently requires knowing your bib.

No schema change. Enhancement to existing `EventFilters` name search.
(The filter already exists — this is just UX polish, e.g. auto-focus or
a "View my result →" CTA when exactly one match is found.)

---

### N4 — Race series page

`/series/ironman-703` — all IM 70.3 events in the system, sortable by date
or location, with athlete counts.

**Schema dependency:** S1 (`seriesName`) or S5 (tags).

---

### N5 — Athlete bests / personal records

On the athlete profile or detail page, surface personal bests:

- Fastest finish time at this race distance
- Best overall rank
- Most net passes in a single race

**Schema dependency:** S3 (`AthleteProfile`) makes this trivially queryable
across races. Can be done with `normalizedName` grouping in the meantime.

---

### N6 — Race comparison (two events side-by-side)

Compare two editions of the same race (e.g. 2025 vs 2026 Oceanside) at
the aggregate level — average finish time, fastest swim, field size changes.
Not athlete-level, just event-level stats.

No schema change. Query-only aggregation.

---

### N7 — Embeddable widgets

A small embeddable card (`<iframe>` or Web Component) that a race organizer
or athlete could paste into their own site or blog showing their result.

No schema change. New `/embed/[slug]/[year]/[bib]` route.

---

## 📦 Tech Debt

### T1 — `Race.country` / `Athlete.country` inconsistency

`Athlete` has a `country` column (sourced from CSV) but `Race` has no country.
With S1 landing, both will have country — worth normalizing to a consistent
ISO 3166-1 alpha-2 code rather than free-text strings from the CSV.

Backfill: low effort once S1 lands.

---

### T2 — `Athlete.gender` / `Athlete.division` free-text

Both are stored as raw strings from the CSV (e.g. "Male", "M", "MALE" can
all appear). No normalization. This will cause grouping/filtering bugs as
more races are ingested from different sources.

Consider: normalize `gender` to an enum (`MALE | FEMALE | NON_BINARY | UNKNOWN`)
and store the raw division string but add a `divisionGroup` field for
coarser grouping (e.g. age group vs pro).

**Schema change:** Enum migration for gender is a destructive change if existing
values aren't uniform. Run `SELECT DISTINCT gender FROM "Athlete"` first to
audit; then migrate with a default.

---

### T3 — `finishTime` stored as String

`Athlete.finishTime` is a display string (e.g. "3:40:07") rather than seconds.
This makes sorting, delta calculation, and personal-best queries rely on string
parsing rather than numeric comparison. `totalSeconds` already exists implicitly
(sum of `AthleteSegment.timeSeconds`) but isn't persisted on the athlete row.

**Proposed:** Add `finishSeconds Int?` to `Athlete`, populated at ingest as
`SUM(timeSeconds)` across all non-finish segments. The display string stays
for rendering.

**Schema change:** Nullable addition — zero downtime. Backfill is straightforward.
Unlocks fast numeric sorting and Y-o-Y delta without string parsing.

---

### T4 — No index on `Athlete.normalizedName`

`normalizedName` is used in every race-history query and will be the primary
lookup key for AthleteProfile (S3). It needs a DB index now, before the table
grows large.

**Migration:** `CREATE INDEX` — zero downtime on Postgres (concurrent build).
Add `@@index([normalizedName])` to `Athlete` in schema.prisma.

---

### T5 — `epochTime` on `AthleteSegment` — unclear provenance

`epochTime` is stored but never used in any query or UI. Either document what
it represents and wire it up, or remove it to reduce confusion.

---

### T6 — Ingest script error handling / idempotency reporting

The ingest script is idempotent (upserts) but silent about conflicts. When
re-ingesting, it would be useful to report: rows updated vs rows unchanged vs
rows newly created.

---

## 🗓 Migration Batching Recommendation

Before the next significant data push, consider landing these in one migration:

| Priority | Item | Change                     | Risk                            |
| -------- | ---- | -------------------------- | ------------------------------- |
| High     | T4   | Index on `normalizedName`  | Zero downtime                   |
| High     | S1   | Race metadata fields       | Nullable, zero downtime         |
| High     | T3   | `finishSeconds` on Athlete | Nullable, zero downtime         |
| Medium   | S2   | Event denormalized counts  | Nullable, zero downtime         |
| Medium   | T2   | Gender normalization       | Audit first — may need default  |
| Lower    | S3   | AthleteProfile model       | Additive table + FK             |
| Lower    | S4   | Position snapshots         | Only if source data supports it |

The top three (T4, S1, T3) are the highest value-to-effort ratio and can be
landed as a single migration with minimal risk.
