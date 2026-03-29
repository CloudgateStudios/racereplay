# RaceReplay — Architecture

**Version:** 1.0
**Last Updated:** 2026-03-29

---

## Overview

RaceReplay is a single Next.js 15 application deployed to Vercel. It uses API Routes for the backend and Server Components for most pages. The database is PostgreSQL hosted on Supabase, accessed via Prisma.

There is no separate backend service — Next.js API routes handle all data access. This is appropriate because:
- All data is static after upload (no real-time writes from users)
- Query volume is modest (not a high-traffic social platform)
- Deployment simplicity is a priority

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

### Admin CSV upload

```
Browser → POST /api/admin/upload  (multipart/form-data)
  → Verify x-admin-secret header
  → Parse CSV stream → RawResult[]
  → Convert HH:MM:SS → seconds
  → Upsert Race
  → Bulk insert Athletes + Results
  → Run passing-calc.ts on full field in memory
  → Bulk update result.passingData + rank fields
  → Return { athletesImported, dnfCount, durationMs }
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
│   └── page.tsx                    Server Component — list races with upload links
└── admin/upload/
    └── page.tsx                    Client Component — CSV upload form with secret field
```

Most pages are **Server Components** (fast, no client JS for data fetching). The athlete search and passing analysis UI use **Client Components** for interactivity.

---

## Data Layer

### Database: Supabase (PostgreSQL)

Two connection strings (standard Prisma + Supabase pattern):
- `DATABASE_URL` — PgBouncer pooled connection, used at runtime for all queries
- `DIRECT_URL` — Direct Supabase connection, used only for `prisma migrate`

### ORM: Prisma

Schema at `prisma/schema.prisma`. Generated client used everywhere via `src/lib/prisma.ts` singleton.

### Data flow on import

```
CSV file
  → csv-parser.ts         Parses CSV, maps columns flexibly, returns RawResult[]
  → time-utils.ts         Converts all "HH:MM:SS" strings to integer seconds
  → /api/admin/upload     Upserts Race, bulk-inserts Athletes + Results
  → passing-calc.ts       Pure function: RawResult[] → Map<athleteId, PassingData>
  → DB update             Writes passingData JSONB + computed rank fields
```

The passing calculation is a **pure in-memory function** with no DB calls during computation. It receives the full race field as an array, computes all passing relationships, and returns a map. This makes it fast and independently unit-testable.

---

## Passing Calculation

The core algorithm lives in `src/lib/passing-calc.ts`. It works as follows:

For each of the 5 legs (swim, T1, bike, T2, run):

1. Build a **before snapshot**: sort all eligible athletes by cumulative time at the start of the leg
2. Build an **after snapshot**: sort all eligible athletes by cumulative time at the end of the leg
3. For each athlete X:
   - `passedBibs` = athletes ranked ahead of X in before-snapshot AND ranked behind X in after-snapshot (X overtook them)
   - `passedByBibs` = athletes ranked behind X in before-snapshot AND ranked ahead of X in after-snapshot (they overtook X)

Eligibility: Athletes who DNS/DNF/DSQ at a given leg are excluded from that leg's rankings and all subsequent legs.

**Leg boundary definitions (cumulative seconds):**

| Snapshot point | Cumulative time used |
|---|---|
| Start of swim | 0 (everyone together) |
| End of swim / start of T1 | swimSecs |
| End of T1 / start of bike | swimSecs + t1Secs |
| End of bike / start of T2 | swimSecs + t1Secs + bikeSecs |
| End of T2 / start of run | swimSecs + t1Secs + bikeSecs + t2Secs |
| Finish | finishSecs |

T1 and T2 are treated as scoreable legs in their own right — athletes who are fast in transition genuinely pass people there.

---

## Admin Security

Admin routes are protected by a single `ADMIN_SECRET` environment variable. The upload form sends this as the `x-admin-secret` request header. The `admin-auth.ts` helper checks it on every admin API route. This is a simple but sufficient mechanism for a low-traffic internal tool.

Do not use a short or guessable secret. Rotate it if compromised.

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
| Function timeout | `maxDuration: 60` on the upload route (requires Vercel Pro) |

---

## Performance Considerations

- Passing data is **pre-computed** at upload time — no computation at query time
- Race and athlete data rarely changes after upload — aggressive caching is safe
- Server Components avoid client-side data fetching round trips for most pages
- Athlete search (`?q=`) hits a database full-text search index on `athlete.fullName`
- For very large races (3000+ athletes), the CSV import uses chunked bulk inserts to avoid Prisma memory pressure

---

## Future Architecture Notes

If RaceReplay grows to support:
- **Many races / high traffic** — add Next.js `unstable_cache` or Redis for race/result reads
- **Other race formats** — make leg definitions configurable per race (stored in DB), and make the passing calc algorithm leg-format-aware
- **Athlinks integration** — add a scheduled job (Vercel cron or separate worker) that polls Athlinks API and auto-imports new races
