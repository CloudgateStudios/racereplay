# RaceReplay — Data Model

**Version:** 1.0
**Last Updated:** 2026-03-29

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

// ─── Race ─────────────────────────────────────────────────────────────────────

model Race {
  id        String    @id @default(cuid())
  slug      String    @unique   // URL-safe identifier, e.g. "kona-2024"
  name      String              // Full display name, e.g. "IRONMAN World Championship 2024"
  location  String              // e.g. "Kailua-Kona, Hawaii"
  date      DateTime  @db.Date
  distance  Distance
  createdAt DateTime  @default(now())

  athletes  Athlete[]

  @@map("races")
}

// ─── Athlete ──────────────────────────────────────────────────────────────────

model Athlete {
  id       String  @id @default(cuid())
  raceId   String
  bib      String            // As printed on race bib
  fullName String
  country  String?           // ISO 3166-1 alpha-3, e.g. "USA"
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

  // ── Official rankings (from source CSV) ──────────────────────────────────

  overallRank   Int?
  genderRank    Int?
  divisionRank  Int?

  // ── Computed rankings at each transition (populated by import pipeline) ──
  //
  // These are ranks by cumulative time at each transition point, among all
  // athletes who were still active at that point.
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
  gained: number        // Net positions gained (positive = moved up the field)
  lost: number          // Positions lost (positive = dropped back)
  passedBibs: string[]  // Bibs of athletes X passed (were ahead of X before, behind X after)
  passedByBibs: string[] // Bibs of athletes who passed X (were behind X before, ahead of X after)
}

export type PassingData = {
  swim:    LegPassingStats
  t1:      LegPassingStats
  bike:    LegPassingStats
  t2:      LegPassingStats
  run:     LegPassingStats
  overall: {
    finishRank: number   // = overallRank
    netGained: number    // Sum of gained - lost across all legs
  }
}
```

**Why bibs (not IDs)?** Bibs are stable, human-readable identifiers from the source data. When displaying "who passed you", the UI resolves bibs to full names via a join. Using bibs avoids storing opaque UUIDs in JSON.

---

## Design Decisions

### 1. All times stored as integer seconds

`swimSecs: Int?` rather than `swimTime: String`. Reasons:
- Sort and compare operations are trivially correct on integers
- No parsing at query time
- Easy to add/subtract for cumulative calculations
- Display formatting (`HH:MM:SS`, `MM:SS`) happens at the component layer via `time-utils.ts`

### 2. Pre-computed passing data as JSONB

Passing analysis could be derived at query time from the `afterXRank` fields, but:
- The "who specifically passed you" question requires O(n) cross-athlete comparison
- Pre-computing once at import (O(n²) one-time cost) keeps every subsequent read O(1)
- JSONB is flexible — the shape can evolve without a migration for the heavy data
- The `afterXRank` integer fields are kept anyway for indexed range queries

### 3. Division stored as a plain string

`division: String` rather than a structured enum. Reasons:
- Division naming varies between race organisations ("M35-39" vs "M 35-39" vs "35-39M")
- Not used in any joins or FK relationships
- Full structured division parsing (for filtered leaderboards) is a post-MVP feature

### 4. Cascade deletes

`onDelete: Cascade` on both `Athlete → Race` and `Result → Athlete`. Deleting a race cleans up all associated athletes and results automatically.

### 5. No user table

RaceReplay has no user accounts. There is nothing to store per-user. Admin access is controlled by the `ADMIN_SECRET` env var, not a DB record.

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

There is no traditional seed file. Data enters the system exclusively through the admin CSV upload pipeline (`POST /api/admin/upload`). The import pipeline is the canonical way to populate the database.

For development, use a real Ironman results CSV (e.g. download from [coachcox.co.uk/imstats](https://www.coachcox.co.uk/imstats/) or export via the ironman-results Node.js scraper).
