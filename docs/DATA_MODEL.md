# RaceReplay — Data Model

**Version:** 1.2
**Last Updated:** 2026-03-30

---

## Overview

The schema is intentionally lean. There are three main entities: `Race`, `Athlete`, and `Result`. All passing analytics live as pre-computed JSONB on `Result`.

---

## Full Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

// ─── Enums ────────────────────────────────────────────────────────────────────

enum Distance {
  FULL   // Full-distance Ironman (3.8km swim / 180km bike / 42.2km run)
  HALF   // 70.3 / half-distance (1.9km / 90km / 21.1km)
}

enum Gender {
  M
  F
  X  // Non-binary / unspecified
}

enum PassingMode {
  PHYSICAL   // Per-athlete start times from RTRT — true physical passing
  CHIP_ONLY  // No start time data — chip-time rank comparison (gun-start fallback)
}

// ─── Race ─────────────────────────────────────────────────────────────────────

model Race {
  id          String      @id @default(cuid())
  slug        String      @unique   // URL-safe identifier, e.g. "oceanside703-2026"
  name        String                // Full display name, e.g. "IRONMAN 70.3 Oceanside 2026"
  location    String                // e.g. "Oceanside, California"
  date        DateTime    @db.Date
  distance    Distance
  passingMode PassingMode @default(CHIP_ONLY)
  // Ordered list of leg names for this race, e.g. ["Swim","T1","Bike","T2","Run"]
  // or ["5K","Finish"]. Populated at import time from the timing points fetched.
  // Drives UI rendering — the frontend iterates this array to display leg cards
  // in the correct order without hardcoding race formats.
  legs        Json?
  // RTRT event ID used to fetch this race (e.g. "IRM-OCEANSIDE703-2026").
  // Stored for re-import and audit. Not exposed via public API.
  rtrtEventId String?
  createdAt   DateTime    @default(now())

  athletes    Athlete[]

  @@map("races")
}

// ─── Athlete ──────────────────────────────────────────────────────────────────

model Athlete {
  id       String  @id @default(cuid())
  raceId   String
  bib      String            // As printed on race bib
  fullName String
  country  String?           // ISO 3166-1 alpha-2, e.g. "US"
  division String            // Age group + gender, e.g. "M35-39", "FPRO", "M18-24"
  gender   Gender

  race     Race    @relation(fields: [raceId], references: [id], onDelete: Cascade)
  result   Result?

  @@unique([raceId, bib])    // Bibs are unique within a race
  @@index([raceId, fullName]) // Powers name search
  @@map("athletes")
}

// ─── Result ───────────────────────────────────────────────────────────────────

model Result {
  id        String @id @default(cuid())
  athleteId String @unique
  raceId    String

  // ── Split times (seconds per leg) ────────────────────────────────────────
  //
  // splits: keyed by leg name, value is integer seconds. Null legs (DNF) are
  // omitted from the object entirely rather than stored as null values.
  // Example (triathlon): { "Swim": 1842, "T1": 210, "Bike": 8340, "T2": 180, "Run": 5646 }
  // Example (road race):  { "5K": 1423, "Finish": 2891 }
  // The set of keys always matches race.legs in order.

  splits     Json?

  // finishSecs: total elapsed seconds (sum of all legs). Stored as a typed
  // integer column — not inside the splits JSON — because it's the primary
  // sort key for leaderboard ordering and needs a DB index.

  finishSecs Int?

  // ── Race status ───────────────────────────────────────────────────────────

  dns Boolean @default(false)  // Did Not Start
  dnf Boolean @default(false)  // Did Not Finish
  dsq Boolean @default(false)  // Disqualified

  // ── Physical start data (from RTRT.me) ───────────────────────────────────
  //
  // waveOffset: seconds after the earliest starter in the race that this
  // athlete crossed the start mat. This is the key input to the physical
  // passing algorithm.
  //
  // Example: if the first athlete started at epoch 1774704000 and this athlete
  // started at epoch 1774704120, their waveOffset = 120.0 seconds.
  //
  // Null when race.passingMode = CHIP_ONLY (no RTRT data available).

  waveOffset Float?

  // ── Official rankings (from source data) ─────────────────────────────────

  overallRank   Int?
  genderRank    Int?
  divisionRank  Int?

  // ── Computed rankings at each leg exit (populated by import pipeline) ────
  //
  // splitRanks: keyed by leg name, value is overall rank by cumulative chip
  // time among athletes still active at that point. Keys match race.legs
  // (excluding the final leg, whose rank == overallRank).
  // Example: { "Swim": 820, "T1": 800, "Bike": 760, "T2": 755 }
  //
  // Stored as JSONB rather than typed columns so the schema works for any
  // number of legs. Not indexed — rank lookups are done via passingData or
  // by sorting on finishSecs; mid-race rank display reads from this field.

  splitRanks Json?

  // ── Pre-computed passing analysis (populated by import pipeline) ──────────
  //
  // Shape: PassingData (see src/types/index.ts)
  // Stored as JSONB. Never re-derived at query time.

  passingData Json?

  athlete Athlete @relation(fields: [athleteId], references: [id], onDelete: Cascade)

  @@index([raceId, overallRank])
  @@index([raceId, finishSecs])
  @@map("results")
}
```

---

## PassingData JSONB Shape

The `passingData` field on `Result` is typed as follows (see `src/types/index.ts`):

```typescript
export type LegPassingStats = {
  gained: number         // Positions gained (athletes X passed)
  lost: number           // Positions lost (athletes who passed X)
  passedBibs: string[]   // Bibs of athletes X passed during this leg
  passedByBibs: string[] // Bibs of athletes who passed X during this leg
}

export type PassingData = {
  swim:    LegPassingStats
  t1:      LegPassingStats
  bike:    LegPassingStats
  t2:      LegPassingStats
  run:     LegPassingStats
  overall: {
    finishRank: number   // = overallRank
    netGained: number    // Sum of (gained - lost) across all legs
  }
}
```

**Why bibs (not IDs)?** Bibs are stable, human-readable identifiers from the source data. When displaying "who passed you", the UI resolves bibs to full names via a join. Using bibs avoids storing opaque UUIDs in JSON.

---

## Design Decisions

### 1. Split times and intermediate ranks stored as JSONB, not typed columns

Early versions of the schema used typed columns (`swimSecs`, `t1Secs`, `bikeSecs`,
`t2Secs`, `runSecs`, `afterSwimRank`, `afterT1Rank`, `afterBikeRank`, `afterT2Rank`).
This hardcoded the triathlon format into the schema — a Shamrock Shuffle result row
would have 8 NULL columns, and a race with 8 legs would overflow the schema entirely.

The replacement:
- `splits Json?` — `{ legName: seconds }`, keys match `race.legs` in order
- `splitRanks Json?` — `{ legName: rank }`, same keys (excluding final leg)
- `finishSecs Int?` — kept as a typed column for indexed leaderboard sorting

The only query that needs a column index on results is "sort all athletes in a race
by finish time." Everything else is a single-row read by athlete ID, where JSONB
deserialization is negligible. No other result column is ever used as a sort or
filter key in practice.

### 2. All split times stored as integer seconds

`swimSecs: Int?` rather than `swimTime: String`. Reasons:
- Sort and compare operations are trivially correct on integers
- No parsing at query time
- Easy to add/subtract for cumulative calculations
- Display formatting (`HH:MM:SS`, `MM:SS`) happens at the component layer via `time-utils.ts`

### 2. `waveOffset` stored as Float (not epoch)

`waveOffset` is the seconds after the earliest starter that this athlete began. This is computed once at import time from RTRT's raw `epochTime` values:

```
waveOffset = athleteStartEpoch - min(allStartEpochs)
```

We store the relative offset rather than the raw epoch because:
- The passing algorithm only needs relative differences between athletes — absolute epoch time is irrelevant
- Float seconds are simpler to work with in SQL and TypeScript than large epoch integers
- The raw epoch timestamps are not stored — we do not redistribute RTRT's raw tracking data

### 3. `passingMode` on Race (not Result)

All athletes in a race are processed with the same mode — either RTRT data is available for the whole race or it isn't. Storing the mode on `Race` rather than each `Result` avoids the inconsistency of a race where some athletes have physical passing and others don't.

### 4. Pre-computed passing data as JSONB

Passing analysis could be derived at query time from the `afterXRank` fields, but:
- The "who specifically passed you" question requires O(n) cross-athlete comparison
- Pre-computing once at import (O(n²) one-time cost) keeps every subsequent read O(1)
- JSONB is flexible — the shape can evolve without a migration for the heavy data

### 5. `rtrtEventId` stored on Race (not exposed publicly)

Stored for audit and re-import purposes. Not returned by the public API. The RTRT event ID is an internal operational detail, not user-facing information.

### 6. Division stored as a plain string

`division: String` rather than a structured enum. Reasons:
- Division naming varies between race organisations ("M35-39" vs "M 35-39" vs "35-39M")
- Not used in any joins or FK relationships
- Full structured division parsing is a post-MVP feature

### 7. Cascade deletes

`onDelete: Cascade` on both `Athlete → Race` and `Result → Athlete`. Deleting a race cleans up all associated athletes and results automatically.

### 8. Passing data stores bibs, not denormalized athlete objects

`passedBibs`/`passedByBibs` store bib strings rather than full athlete records.
When the athlete analysis API route responds, it resolves these to names via a single
`WHERE bib IN (...) AND raceId = ?` query against the indexed `(raceId, bib)` column.

The alternative — storing `{ bib, fullName, division }` inline in the JSONB — was
considered and rejected. It would make the JSONB 3–5× larger, duplicate data that
already lives in `athletes`, and create staleness risk if an athlete record is
corrected post-import.

The resolution query is one indexed round trip per athlete page load. For a typical
athlete resolving ~100 bibs across all legs, this is under 10ms. For mass-start
races (e.g. Shamrock Shuffle 24K field), bib lists are capped at import time with
`--max-bibs` to keep both storage and UI rendering reasonable — the resolution cost
remains the same regardless of list length.

### 9. No user table

RaceReplay has no user accounts. Admin access is controlled by the `ADMIN_SECRET` env var, not a DB record.

---

## Indexes

| Table | Index | Purpose |
|---|---|---|
| athletes | `(raceId, fullName)` | Name search within a race |
| athletes | `(raceId, bib)` UNIQUE | Bib lookup + uniqueness constraint |
| results | `(raceId, overallRank)` | Ordered results list by finish position |
| results | `(raceId, finishSecs)` | Ordered results list by elapsed time |

Mid-race rank lookups (e.g. "rank after swim") use `splitRanks` JSONB, which is
read from the pre-fetched result row — no additional index is needed because the
query is always for a single athlete, never a sorted scan across the field.

---

## Seed / Import

There is no traditional seed file. Data enters the system exclusively through the admin import pipeline (`POST /api/admin/import`). The pipeline fetches from RTRT.me (and optionally competitor.com), merges sources, and populates the database.

For development, you can import any recent Ironman 70.3 race using the RTRT event ID:
- Find the event at `track.rtrt.me` — search for the race name
- Use the event ID with the admin import UI or the POC scripts in `scripts/`
