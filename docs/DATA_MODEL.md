# RaceReplay — Data Model

**Version:** 1.1
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

  // ── Raw split times (seconds, null if athlete did not complete that leg) ──

  swimSecs   Int?
  t1Secs     Int?
  bikeSecs   Int?
  t2Secs     Int?
  runSecs    Int?
  finishSecs Int?    // Total elapsed = swim + t1 + bike + t2 + run

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

  // ── Computed rankings at each transition (populated by import pipeline) ──
  //
  // Ranks by cumulative chip time at each transition point, among athletes
  // still active at that point. Used for display and indexed queries.
  //
  // afterSwimRank  = rank by swimSecs
  // afterT1Rank    = rank by swimSecs + t1Secs
  // afterBikeRank  = rank by swimSecs + t1Secs + bikeSecs
  // afterT2Rank    = rank by swimSecs + t1Secs + bikeSecs + t2Secs
  // (finish rank == overallRank)

  afterSwimRank  Int?
  afterT1Rank    Int?
  afterBikeRank  Int?
  afterT2Rank    Int?

  // ── Pre-computed passing analysis (populated by import pipeline) ──────────
  //
  // Shape: PassingData (see src/types/index.ts)
  // Stored as JSONB. Never re-derived at query time.

  passingData Json?

  athlete Athlete @relation(fields: [athleteId], references: [id], onDelete: Cascade)

  @@index([raceId, overallRank])
  @@index([raceId, afterSwimRank])
  @@index([raceId, afterT1Rank])
  @@index([raceId, afterBikeRank])
  @@index([raceId, afterT2Rank])
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

### 1. All split times stored as integer seconds

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

### 8. No user table

RaceReplay has no user accounts. Admin access is controlled by the `ADMIN_SECRET` env var, not a DB record.

---

## Indexes

| Table | Index | Purpose |
|---|---|---|
| athletes | `(raceId, fullName)` | Name search within a race |
| athletes | `(raceId, bib)` UNIQUE | Bib lookup + uniqueness constraint |
| results | `(raceId, overallRank)` | Ordered results list |
| results | `(raceId, afterSwimRank)` | Rank lookups at swim exit |
| results | `(raceId, afterT1Rank)` | Rank lookups at T1 exit |
| results | `(raceId, afterBikeRank)` | Rank lookups at bike exit |
| results | `(raceId, afterT2Rank)` | Rank lookups at T2 exit |

---

## Seed / Import

There is no traditional seed file. Data enters the system exclusively through the admin import pipeline (`POST /api/admin/import`). The pipeline fetches from RTRT.me (and optionally competitor.com), merges sources, and populates the database.

For development, you can import any recent Ironman 70.3 race using the RTRT event ID:
- Find the event at `track.rtrt.me` — search for the race name
- Use the event ID with the admin import UI or the POC scripts in `scripts/`
