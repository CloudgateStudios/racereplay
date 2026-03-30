# RaceReplay — Implementation Plan

**Version:** 1.2
**Last Updated:** 2026-03-30

---

## Overview

Four phases. Each phase delivers a usable slice that can be tested independently.

| Phase | Focus | Deliverable |
|---|---|---|
| 1 | Scaffold + DB | Running app skeleton with DB connection |
| 2 | Data pipeline | RTRT fetch + passing calculation + import |
| 3 | Public UI + API | Full athlete search and analysis UI |
| 4 | Polish + Deploy | Production-ready app on Vercel |

---

## Phase 1 — Scaffold + Database

**Goal:** Next.js app running locally, Prisma connected to Supabase, schema migrated.

### 1.1 Project init

- [ ] Scaffold Next.js app:
  ```bash
  npx create-next-app@latest racereplay \
    --typescript --tailwind --app --src-dir \
    --import-alias "@/*"
  ```
- [ ] Install Prisma:
  ```bash
  pnpm add prisma @prisma/client
  pnpm prisma init
  ```
- [ ] Install dev dependencies:
  ```bash
  pnpm add -D vitest @vitest/ui tsx
  ```
- [ ] Install shadcn/ui:
  ```bash
  npx shadcn@latest init
  ```
  Add components: `button`, `card`, `input`, `badge`, `table`, `skeleton`

### 1.2 Database

- [ ] Create two Supabase projects, both in region `us-east-1` (N. Virginia):
  - `racereplay-prod`
  - `racereplay-staging`
- [ ] Copy staging connection strings to `.env.local`:
  ```
  DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
  DIRECT_URL=postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
  ```
- [ ] Write `prisma/schema.prisma` (copy from `DATA_MODEL.md`)
- [ ] Run first migration:
  ```bash
  pnpm prisma migrate dev --name init
  pnpm prisma generate
  ```
- [ ] Write `src/lib/prisma.ts` singleton

### 1.3 Env + config

- [ ] Write `.env.example`:
  ```
  # Supabase — use staging credentials for local dev
  DATABASE_URL=
  DIRECT_URL=

  # Admin protection
  ADMIN_SECRET=

  # RTRT.me — IRONMAN Tracker app ID (server-side only, never expose client-side)
  RTRT_APP_ID=5824c5c948fd08c23a8b4567

  NEXT_PUBLIC_APP_URL=
  ```
- [ ] Add `.env.local` to `.gitignore`
- [ ] Verify `pnpm dev` starts without errors

---

## Phase 2 — Data Pipeline

**Goal:** Admin can trigger an import for a race and all data + passing stats are correctly stored.

### 2.1 Core utilities (write + unit-test before anything else)

- [ ] `src/lib/time-utils.ts`
  - `parseTime(str: string): number | null` — `"1:02:34"` → `3754`; handles `"--"`, `""`, `null`
  - `formatTime(secs: number): string` — `3754` → `"1:02:34"`
  - `formatTimeMM(secs: number): string` — `154` → `"2:34"` (for short legs like T1/T2)
  - Tests: `src/lib/time-utils.test.ts`

- [ ] `src/lib/rtrt-fetcher.ts`
  - `fetchRtrtRace(eventId: string): Promise<RtrtRaceData>`
  - Registers with RTRT API using `process.env.RTRT_APP_ID`
  - Paginates through all 6 timing points: `START`, `SWIM`, `T1`, `BIKE`, `T2`, `FINISH`
  - Handles the end-of-data quirk: `type=no_results` means pagination complete, not an error
  - Rate limits: 300ms between pages, 5s between points
  - Returns `Map<bib, AthleteRecord>` with `netTime` per point and `epochTime` at START
  - See `scripts/fetch-rtrt-race.mjs` for the proven implementation
  - No unit tests (external API) — integration tested via admin import flow

- [ ] `src/lib/passing-calc.ts`
  - `computePassingData(athletes: RawResult[], legs: string[], hasWaveData: boolean): Map<string, PassingData>`
  - Pure function — no DB access, no side effects
  - `legs` is the ordered array from `race.legs` / csv-parser output — no hardcoded leg names
  - Two modes controlled by `hasWaveData`:
    - **Physical (hasWaveData = true):** `waveOffset` is the "before" position for the first leg; all legs use `waveOffset + cumulativeSecs` for position comparisons
    - **Chip-only (hasWaveData = false):** First leg uses chip-rank comparison; all other legs use cumulative chip time
  - Algorithm per leg:
    1. Filter eligible athletes (have both before and after positions in `splits`)
    2. Build `beforeMap: Map<bib, position>` — position at start of leg
    3. Build `afterMap: Map<bib, position>` — position at end of leg
    4. For each athlete X: `passedBibs` = bibs where `before[bib] < before[X]` AND `after[bib] > after[X]`
  - Returns `Map<bib, PassingData>` where `PassingData` keys match `legs` (plus `overall`)
  - Tests: `src/lib/passing-calc.test.ts`
    - Use a toy field of 10 athletes with known split times and wave offsets
    - Assert exact passing relationships for both `hasWaveData = true` and `false`
    - Verify invariant: `sum(gained) === sum(lost)` across full field for every leg
    - Verify DNF athletes excluded at correct leg and all subsequent legs
    - Run tests with both a 5-leg config and a 2-leg config to confirm no hardcoding
    - See `scripts/test-algorithm.mjs` for the full 21-case test suite to port

- [ ] `src/lib/csv-parser.ts`
  - `parseCSV(buffer: Buffer): { legs: string[], results: RawResult[] }`
  - Flexible column mapping: normalise headers (lowercase, strip spaces/punctuation), best match
  - **Leg detection:** any column ending in `(Seconds)` except `Finish (Seconds)`, `Finish Gun (Seconds)`, `Wave Offset (Seconds)` → treat as a leg, in column order. Returns the discovered `legs` array alongside results.
  - Handle DNF/DNS by detecting `--` or empty time strings; absent legs omitted from `splits` map
  - Reads `Wave Offset (Seconds)` column if present → `waveOffset` field
  - Reads pre-computed `<LegName> (Seconds)` columns directly (avoids re-parsing time strings)
  - Tests: `src/lib/csv-parser.test.ts` using fixture CSV files in `src/lib/__fixtures__/`
    - Fixture 1: triathlon CSV (5 legs) — assert correct `legs` array and `splits` shape
    - Fixture 2: road race CSV (2 legs) — assert leg detection works with non-triathlon columns
    - Fixture 3: DNF athlete — assert legs after dropout are absent from `splits`

- [ ] `src/lib/admin-auth.ts`
  - `verifyAdminSecret(req: NextRequest): boolean`

### 2.2 Admin API routes

- [ ] `src/app/api/admin/races/route.ts` — `POST` create race

- [ ] `src/app/api/admin/import/route.ts` — `POST` full RTRT-based import pipeline
  - Accept `{ raceId, rtrtEventId, competitorUrl? }` JSON body
  - Call `rtrt-fetcher.ts` to fetch all 6 points (this takes ~5 min — route needs `maxDuration: 300`)
  - Optionally fetch competitor.com if `competitorUrl` provided
  - Merge by bib
  - Compute `waveOffset` for each athlete
  - Derive `legs` array from the fetched timing point names (in order)
  - Bulk upsert athletes + results via Prisma `createMany` in chunks of 500
    - Store split seconds as `splits` JSON: `{ [legName]: secs }`
    - Store `finishSecs` as typed integer
  - Compute `splitRanks` per athlete (overall rank by cumulative time at each leg exit)
  - Bulk update `result.splitRanks`
  - Run `passing-calc.ts` with the derived `legs` array
  - Bulk update `result.passingData`
  - Run invariant check and include results in response
  - Update `race.passingMode`, `race.legs`, and `race.rtrtEventId`

- [ ] `src/app/api/admin/upload/route.ts` — `POST` legacy CSV upload
  - For importing pre-built CSVs from the POC scripts
  - Use `Request.formData()` for multipart upload
  - Parse CSV → `{ legs, results }` via `csv-parser.ts`
  - Run pipeline: upsert athletes + results, compute `splitRanks`, run passing-calc
  - Update `race.legs` from detected legs
  - Return summary

### 2.3 Admin UI

- [ ] `src/app/admin/page.tsx` — list races with links to import for each

- [ ] `src/app/admin/import/page.tsx` — import form with:
  - Race selector (dropdown of existing races) + "Create new race" inline
  - RTRT event ID input (e.g. `IRM-OCEANSIDE703-2026`) with link to `track.rtrt.me`
  - Optional competitor.com URL input
  - Admin secret input (`type="password"`)
  - Progress display — the RTRT fetch takes ~5 minutes; show a spinner with status updates
  - Result display: finisher count, DNF count, invariant check pass/fail, passing mode

---

## Phase 3 — Public API + UI

**Goal:** Anyone can find an athlete and see their passing analysis.

### 3.1 Public API routes

- [ ] `src/app/api/races/route.ts` — `GET /api/races`
- [ ] `src/app/api/races/[slug]/route.ts` — `GET /api/races/:slug`
- [ ] `src/app/api/races/[slug]/athletes/route.ts` — `GET ?q=&page=&limit=`
  - Use Prisma `contains` + `mode: 'insensitive'` for name search
  - Also match bibs: `bib: { startsWith: q }`
  - Combine with `OR`
- [ ] `src/app/api/races/[slug]/athletes/[id]/route.ts`
  - Fetch result with `splits`, `splitRanks`, `passingData`; fetch race for `legs`
  - Resolve all bibs across all legs: single `WHERE bib IN (...) AND raceId = ?` query
  - Build bib → athlete map; inject into `passedAthletes`/`passedByAthletes` per leg
  - Return full `AthleteAnalysisResponse` shape (see `API_SPEC.md`)

### 3.2 Pages

- [ ] `src/app/page.tsx` — Home
  - Server Component: fetch all races via Prisma directly
  - `RaceCard` component: race name, date, location, finisher count, passing mode badge, link

- [ ] `src/app/[raceSlug]/page.tsx` — Race page
  - Server Component: fetch race metadata
  - `AthleteSearch` client component: debounced input → `GET /api/races/:slug/athletes?q=`
  - Results table: name, bib, division, finish time, rank — each row links to athlete page

- [ ] `src/app/[raceSlug]/athletes/[id]/page.tsx` — Athlete analysis page
  - Server Component: fetch via `GET /api/races/:slug/athletes/:id`
  - Render `PassingAnalysis` with full data
  - Show `waveOffset` as "Start time: +Xm Ys after first wave" when physical mode

### 3.3 Components

- [ ] `src/components/RaceCard.tsx`
- [ ] `src/components/AthleteSearch.tsx` (Client Component)
  - Debounce 300ms
  - Show skeleton while loading
- [ ] `src/components/PassingAnalysis.tsx`
  - Summary: overall rank, net positions, passing mode indicator
  - Iterates `race.legs` to render one `LegCard` per leg — never hardcodes leg names
- [ ] `src/components/LegCard.tsx`
  - Leg name (from `race.legs`), split time from `result.splits[legName]`, rank from `result.splitRanks[legName]`
  - "+N gained / −N lost" badge
  - Expandable "who I passed" / "who passed me" sections
- [ ] `src/components/PassedAthleteList.tsx`
  - Compact list: `#BIB Name (Division)`
  - Collapsed if > 10 entries, "Show all N" toggle

### 3.4 Types

- [ ] `src/types/index.ts`:
  - `RawResult` — input to passing-calc; includes `splits: Record<string, number>`, optional `waveOffset`
  - `PassingData` — keys are leg names from `race.legs` plus `overall`; no hardcoded leg names
  - `LegPassingStats`
  - `AthleteSearchResult`, `AthleteAnalysisResponse`
  - `RaceListItem`, `RaceDetail` — both include `legs: string[]`

---

## Phase 4 — Polish + Deploy

**Goal:** Responsive, production-quality app deployed to Vercel.

### 4.1 Polish

- [ ] Loading skeletons on race page and athlete page
- [ ] Error boundaries: graceful "Race not found" and "Athlete not found" pages
- [ ] Empty states: "No results for [query]"
- [ ] Mobile responsive: all pages usable on 375px viewport
- [ ] `<head>` metadata: title, description, Open Graph tags per page
- [ ] Favicon + basic branding

### 4.2 Performance

- [ ] Add `unstable_cache` to race list and race detail reads
- [ ] Set `Cache-Control: public, max-age=3600` on public API routes
- [ ] Confirm athlete search is fast on a real 3000-athlete dataset

### 4.3 Deploy

- [ ] Create Vercel project (Pro plan), connect GitHub repo, set region to `iad1`
- [ ] Set environment variables in Vercel dashboard for **Production**:
  ```
  DATABASE_URL          (prod Supabase pooled)
  DIRECT_URL            (prod Supabase direct)
  ADMIN_SECRET
  RTRT_APP_ID=5824c5c948fd08c23a8b4567
  NEXT_PUBLIC_APP_URL=https://racereplay.app
  ```
- [ ] Set environment variables for **Preview** (same but staging Supabase)
- [ ] Add `maxDuration: 300` to the import API route (Vercel Pro required):
  ```ts
  export const maxDuration = 300
  ```
- [ ] Run migrations against prod and staging Supabase:
  ```bash
  pnpm prisma migrate deploy
  ```
- [ ] Attach custom domain `racereplay.app`
- [ ] Import a real race via the deployed admin UI (e.g. `IRM-OCEANSIDE703-2026`)
- [ ] Smoke test: find a known athlete, verify ranks, passing stats, and invariant pass

---

## Verification Checklist

Before shipping Phase 3/4:

- [ ] `pnpm test` — all unit tests pass
- [ ] `pnpm typecheck` — zero TypeScript errors
- [ ] `pnpm lint` — zero lint errors
- [ ] Import a triathlon race (≥500 athletes) — `race.legs` = 5 entries, all splits stored correctly
- [ ] Import a road race (e.g. BASS2026) — `race.legs` = 2 entries, same pipeline works without modification
- [ ] Invariant check passes: `sum(gained) === sum(lost)` per leg (returned in import response)
- [ ] Search for an athlete by name and by bib — both work
- [ ] Open athlete analysis — split times render for each leg in `race.legs` order; no hardcoded leg names in UI
- [ ] `result.splits` and `result.splitRanks` keys match `race.legs` exactly
- [ ] Physical passing mode: confirm `waveOffset` is shown on athlete page, passing mode badge on race page
- [ ] DNF athlete: `result.splits` stops at the leg they dropped; `passingData` stops at same point
- [ ] Mobile layout correct at 375px
