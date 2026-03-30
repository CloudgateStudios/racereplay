# RaceReplay — Architecture

**Version:** 1.1
**Last Updated:** 2026-03-30

---

## Overview

RaceReplay is a single Next.js 15 application deployed to Vercel. It uses API Routes for the backend and Server Components for most pages. The database is PostgreSQL hosted on Supabase, accessed via Prisma.

There is no separate backend service — Next.js API routes handle all data access. This is appropriate because:
- All data is static after import (no real-time writes from users)
- Query volume is modest (not a high-traffic social platform)
- Deployment simplicity is a priority

---

## Data Sources

Race data comes from two separate external systems. Both are called **server-side during admin import only** — never from client-side code, never on page load.

### competitor.com

`labs-v2.competitor.com` is backed by Microsoft Dynamics 365 CRM and serves as the official post-race results system. A single API endpoint returns all athlete records for a given event UUID:

```
GET https://labs-v2.competitor.com/api/results?wtc_eventid=<UUID>
```

This provides chip-elapsed split times (swim, T1, bike, T2, run, finish), official rankings, and athlete profile data. It does **not** provide start times, gun times, or wave offsets of any kind — confirmed by scanning all API fields across full race fields. Results are typically published 1–3 days after the race.

**Finding the event UUID:** Go to the race results page on ironman.com → View Page Source → search for `labs-v2.competitor.com`. The UUID is in the iframe `src` URL.

### RTRT.me

`api.rtrt.me` is the backend behind the official IRONMAN Tracker iOS/Android app. It records a precise Unix epoch timestamp at every timing mat crossing for every athlete.

```
GET https://api.rtrt.me/register?appid=<APPID>
  → { token: "abc123" }

GET https://api.rtrt.me/events/<eventId>/points/<POINT>/splits
    ?appid=<APPID>&token=<TOKEN>&start=<N>
  → { list: [ { bib, name, epochTime, netTime, startTime, ... } ], info: { last } }
```

Key timing points: `START`, `SWIM`, `T1`, `BIKE`, `T2`, `FINISH`. Responses are paginated at 20 records per page.

RTRT data is typically available within hours of race completion — usually before competitor.com publishes results.

**Finding the event ID:** Go to `track.rtrt.me`, search for the race. The URL becomes `track.rtrt.me/e/IRM-OCEANSIDE703-2026`. The segment after `/e/` is the event ID.

Common naming patterns:
- `IRM-<RACENAME>703-<YEAR>` for 70.3 races (e.g. `IRM-OCEANSIDE703-2026`)
- `IRM-<RACENAME>-<YEAR>` for full-distance races (e.g. `IRM-KONA-2026`)

#### RTRT access approach

RTRT.me does not publish a public developer API or terms of service. The import pipeline authenticates using the IRONMAN Tracker app's registered app ID — the same ID embedded in the public iOS/Android app binary and not a private credential. Registration is unauthenticated (`GET /register?appid=...`) and returns a short-lived session token.

**This is pragmatic, not an official arrangement.** The long-term goal is a formal data partnership with WTC (IRONMAN's parent company) and/or RTRT. For now, the following constraints ensure responsible, minimal usage:

| Constraint | Detail |
|---|---|
| Server-side only | RTRT calls are made from Next.js API routes during admin imports, never from client code or exposed via our public API |
| One-time per race | The full point fetch runs once at import time; results are stored in our DB |
| Rate limited | 300ms delay between pages within a point; 5s pause between timing points (~5 min total per race) |
| No raw data redistribution | We store only derived analytics (`waveOffset` in seconds) — raw epoch timestamps are not stored in the DB or exposed via our API |
| No re-fetching | RTRT is never called on page loads; all read traffic is served from our own database |

The `RTRT_APP_ID` is stored as an environment variable, not hardcoded, and must never appear in client-side bundles or API responses.

#### RTRT API quirks (discovered in production)

- **Pagination overflow:** When a timing point's total record count is an exact multiple of the page size (20), requesting the next page returns `{ "error": { "type": "no_results" } }` rather than an empty list. This is end-of-data, not a real error — return whatever has been collected.
- **Token lifetime:** Session tokens last the duration of a reasonable fetch session (confirmed >2 minutes). Re-register if a non-`no_results` error appears mid-fetch.
- **Rate limiting:** The API throttles after ~160 rapid requests on a single token. The 300ms inter-page and 5s inter-point delays stay well under this threshold.

---

## Request Flow

### Public athlete search

```
Browser → GET /[raceSlug]?q=John
  → Next.js Server Component
  → prisma.athlete.findMany({ where: { fullName: { contains: q } } })
  → Returns rendered page
```

### Athlete analysis page

```
Browser → GET /[raceSlug]/athletes/[id]
  → Next.js Server Component
  → prisma.result.findUnique({ where: { athleteId: id }, include: { athlete: true } })
  → passingData JSONB hydrated into PassingData type
  → Renders analysis UI (no client-side fetch needed)
```

### Admin race import

```
Admin UI → POST /api/admin/import  (JSON: { rtrtEventId, competitorUrl? })
  → Verify x-admin-secret header
  → Fetch RTRT data (server-side, ~5 min for 3000-athlete race):
      START + SWIM + T1 + BIKE + T2 + FINISH splits, paginated
  → Optionally fetch competitor.com chip times (if competitorUrl provided)
  → Merge records by bib — competitor.com takes precedence for split times when available
  → Compute waveOffset per athlete = round(startEpoch - minStartEpoch) seconds
  → Upsert Race, Athletes, Results
  → Run passing-calc.ts on full field in memory
  → Bulk update result.passingData + rank fields
  → Return { athletesImported, finishers, dnfCount, passingMode, durationMs }
```

---

## Component Architecture

```
src/app/
├── page.tsx                        Server Component — fetch all races, render RaceCard list
├── [raceSlug]/
│   └── page.tsx                    Server Component — fetch race + paginated athletes
│       └── AthleteSearch.tsx       Client Component — debounced search, hits /api/races/:slug/athletes
├── [raceSlug]/athletes/[id]/
│   └── page.tsx                    Server Component — fetch full result + passingData
│       ├── PassingAnalysis.tsx     Client Component — renders per-leg analysis
│       ├── LegCard.tsx             Client Component — one leg's stats
│       └── PassedAthleteList.tsx   Client Component — expandable list of names
├── admin/
│   └── page.tsx                    Server Component — list races with import links
└── admin/import/
    └── page.tsx                    Client Component — import form (RTRT event ID + optional competitor.com URL)
```

Most pages are **Server Components** (fast, no client JS for data fetching). The athlete search and passing analysis UI use **Client Components** for interactivity.

---

## Data Layer

### Database: Supabase (PostgreSQL)

Two connection strings (standard Prisma + Supabase pattern):
- `DATABASE_URL` — PgBouncer pooled connection, used at runtime for all queries
- `DIRECT_URL` — Supabase direct connection, used only for `prisma migrate`

### ORM: Prisma

Schema at `prisma/schema.prisma`. Generated client used everywhere via `src/lib/prisma.ts` singleton.

### Data flow on import

```
RTRT.me API
  → rtrt-fetcher.ts        Registers, paginates all 6 timing points, returns Map<bib, splitRecord>
  → (optional) competitor.com API
  → race-merger.ts         Merges by bib; competitor.com wins on split time conflicts
  → time-utils.ts          Converts "H:MM:SS" strings → integer seconds
  → /api/admin/import      Upserts Race, Athletes, Results (waveOffset computed here)
  → passing-calc.ts        Pure fn: RawResult[] → Map<bib, PassingData>
  → DB update              Writes passingData JSONB + afterXRank fields
```

---

## Passing Calculation

The core algorithm lives in `src/lib/passing-calc.ts`. It is a pure function with no DB calls — receives the full race field, returns a map of per-athlete passing data.

### Physical passing mode (RTRT start times available)

For each of the 5 legs (swim, T1, bike, T2, run):

1. Build a **before snapshot**: sort all eligible athletes by physical position at the start of the leg
2. Build an **after snapshot**: sort all eligible athletes by physical position at the end of the leg
3. For each athlete X:
   - `passedBibs` = bibs ranked physically ahead of X before AND behind X after (X overtook them)
   - `passedByBibs` = bibs ranked physically behind X before AND ahead of X after (they overtook X)

**Physical position = `waveOffset + cumulativeChipSeconds`** — the seconds elapsed since the earliest starter that this athlete was at any given point on course.

**Swim leg specifically:** Uses `waveOffset` alone as "before" (who was already in the water ahead of you at your start) and `waveOffset + swimSecs` as "after" (who exited T1 first).

**Leg boundary positions:**

| Point | Position value |
|---|---|
| Before swim | `waveOffset` |
| After swim / before T1 | `waveOffset + swimSecs` |
| After T1 / before bike | `waveOffset + swimSecs + t1Secs` |
| After bike / before T2 | `waveOffset + swimSecs + t1Secs + bikeSecs` |
| After T2 / before run | `waveOffset + swimSecs + t1Secs + bikeSecs + t2Secs` |
| Finish | `waveOffset + finishSecs` |

### Chip-only mode (no start time data)

Same algorithm with `waveOffset = 0` for all athletes. Swim passing reflects only chip-swim-time differences — correct for gun-start races.

### Eligibility

Athletes who DNF at a leg are excluded from that leg and all subsequent legs. DNF athletes do not appear in passing stats for legs they never completed.

### Invariant check

**For every leg: `sum(gained) === sum(lost)` across the full field.**

Every physical pass is counted once for the passer and once for the passed — this is a mathematical identity. It serves as the primary post-import correctness check and should be verified after every race import.

---

## Admin Security

Admin routes are protected by a single `ADMIN_SECRET` environment variable, checked via the `x-admin-secret` request header. No full auth system.

The RTRT app ID (`RTRT_APP_ID`) is stored as an environment variable. It must never appear in client-side bundles, be returned in API responses, or be logged.

---

## Deployment

| Concern | Details |
|---|---|
| Hosting | Vercel Pro (single project) |
| Vercel region | `iad1` (Washington D.C., US East) |
| Database | Supabase — two projects: one for **production**, one for **staging** |
| Supabase region | `us-east-1` (N. Virginia) — matches Vercel `iad1` |
| Env vars | Set in Vercel project settings per environment (production + preview) |
| Custom domain | `racereplay.app` |
| Function timeout | `maxDuration: 300` on the import route (Vercel Pro) — RTRT fetch takes ~5 min for large races |

---

## Performance Considerations

- Passing data is **pre-computed** at import time — zero computation at query time
- Race and athlete data is immutable after import — aggressive caching is safe
- Server Components avoid client-side data fetching round trips for most pages
- Athlete search (`?q=`) uses a database index on `athlete.fullName`
- For large races (3000+ athletes), bulk inserts are chunked in groups of 500
- The RTRT fetch (~5 min) dominates import time; the passing calculation itself runs in <2 seconds

---

## Future Architecture Notes

If RaceReplay grows:
- **High traffic** — add `unstable_cache` or Redis for race/result reads
- **Other race formats** — configurable leg definitions per race stored in DB
- **Official WTC/RTRT data partnership** — replace the pragmatic app-ID approach with a proper API key or push-based data feed; also eliminates the rate-limit concern and makes the import much faster
- **Background import jobs** — move the RTRT fetch to a Vercel background function or queue so the admin UI gets an immediate response and polls for completion status
