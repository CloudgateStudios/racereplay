# RaceTrace — Implementation Plan

**Version:** 1.0
**Last Updated:** 2026-03-29

---

## Overview

Four phases. Each phase delivers a usable slice that can be tested independently.

| Phase | Focus | Deliverable |
|---|---|---|
| 1 | Scaffold + DB | Running app skeleton with DB connection |
| 2 | Data pipeline | CSV import + passing calculation |
| 3 | Public UI + API | Full athlete search and analysis UI |
| 4 | Polish + Deploy | Production-ready app on Vercel |

---

## Phase 1 — Scaffold + Database

**Goal:** Next.js app running locally, Prisma connected to Supabase, schema migrated.

### 1.1 Project init

- [ ] Scaffold Next.js app:
  ```bash
  npx create-next-app@latest racetrace \
    --typescript --tailwind --app --src-dir \
    --import-alias "@/*"
  ```
- [ ] Init pnpm (or keep npm — either works)
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
- [ ] Write `CLAUDE.md` at repo root (copy from seed docs)
- [ ] Write `docs/` folder (copy from seed docs)

### 1.2 Database

- [ ] Create Supabase project (one for staging, one for production)
- [ ] Copy connection strings to `.env.local`:
  ```
  DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
  DIRECT_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
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
  DATABASE_URL=
  DIRECT_URL=
  ADMIN_SECRET=
  NEXT_PUBLIC_APP_URL=
  ```
- [ ] Add `.env.local` to `.gitignore`
- [ ] Verify `pnpm dev` starts without errors

---

## Phase 2 — Data Pipeline

**Goal:** Admin can upload a CSV and all data + passing stats are correctly stored.

### 2.1 Core utilities (write + unit-test before anything else)

- [ ] `src/lib/time-utils.ts`
  - `parseTime(str: string): number | null` — `"1:02:34"` → `3754` seconds; handles `"--"`, `""`, `null`
  - `formatTime(secs: number): string` — `3754` → `"1:02:34"`
  - `formatTimeMM(secs: number): string` — `154` → `"2:34"` (for short legs)
  - Tests: `src/lib/time-utils.test.ts`

- [ ] `src/lib/csv-parser.ts`
  - `parseCSV(buffer: Buffer): RawResult[]`
  - Flexible column mapping: normalise header names (lowercase, remove spaces/punctuation), find best match
  - Handle DNF/DNS by detecting `--` or empty time strings
  - Infer gender from division string if no gender column (`M35-39` → `M`, `F30-34` → `F`, `PRO` → needs gender col)
  - Tests: `src/lib/csv-parser.test.ts` using fixture CSV files in `src/lib/__fixtures__/`

- [ ] `src/lib/passing-calc.ts`
  - `computePassingData(athletes: RawResult[]): Map<string, PassingData>`
  - Pure function — no DB access, no side effects
  - Algorithm (per leg):
    1. Filter eligible athletes (completed that leg)
    2. Sort by cumulative time at start of leg → `beforeMap: Map<bib, rank>`
    3. Sort by cumulative time at end of leg → `afterMap: Map<bib, rank>`
    4. For each athlete X:
       - `passedBibs` = bibs where `beforeMap[bib] > beforeMap[X.bib]` AND `afterMap[bib] < afterMap[X.bib]`
       - `passedByBibs` = bibs where `beforeMap[bib] < beforeMap[X.bib]` AND `afterMap[bib] > afterMap[X.bib]`
  - Tests: `src/lib/passing-calc.test.ts`
    - Use a toy field of 10 athletes with known split times
    - Assert exact passing relationships
    - Verify: `sum(all gained) === sum(all lost)` across the field
    - Verify DNF athletes excluded at correct leg

- [ ] `src/lib/admin-auth.ts`
  - `verifyAdminSecret(req: NextRequest): boolean`

### 2.2 Admin API routes

- [ ] `src/app/api/admin/races/route.ts` — `POST` create race
- [ ] `src/app/api/admin/upload/route.ts` — `POST` full import pipeline
  - Use `next/server` `Request.formData()` to receive multipart
  - Parse CSV, run utilities, bulk-upsert via Prisma `createMany`
  - Chunked insert: batch athletes in groups of 500 to avoid memory issues
  - Return import summary

### 2.3 Admin UI

- [ ] `src/app/admin/page.tsx` — list races with link to upload for each
- [ ] `src/app/admin/upload/page.tsx` — form with:
  - Race selector (dropdown of existing races) + "Create new race" inline
  - File input for CSV
  - Admin secret input (type="password")
  - Progress/result display after submit

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
  - Fetch result with `passingData`
  - Resolve bib arrays in `passedBibs`/`passedByBibs` → full athlete objects
  - Return full `AthleteAnalysisResponse` shape

### 3.2 Pages

- [ ] `src/app/page.tsx` — Home
  - Server Component: fetch all races via Prisma directly (not via API)
  - `RaceCard` component: race name, date, location, finisher count, link

- [ ] `src/app/[raceSlug]/page.tsx` — Race page
  - Server Component: fetch race metadata
  - `AthleteSearch` client component: debounced input → `GET /api/races/:slug/athletes?q=`
  - Results table: name, bib, division, finish time, rank — each row links to athlete page

- [ ] `src/app/[raceSlug]/athletes/[id]/page.tsx` — Athlete analysis page
  - Server Component: fetch via `GET /api/races/:slug/athletes/:id`
  - Render `PassingAnalysis` with full data
  - Page title: `<name> — <race name> — RaceTrace`

### 3.3 Components

- [ ] `src/components/RaceCard.tsx`
- [ ] `src/components/AthleteSearch.tsx` (Client Component)
  - Debounce 300ms
  - Show skeleton while loading
  - Clear button
- [ ] `src/components/PassingAnalysis.tsx`
  - Summary bar: overall rank, net positions gained, positions gained vs lost
  - Five `LegCard` components in a row (or stack on mobile)
- [ ] `src/components/LegCard.tsx`
  - Leg name, split time, rank after leg
  - "+N gained / -N lost" badge
  - "Show who I passed" / "Show who passed me" expandable sections
- [ ] `src/components/PassedAthleteList.tsx`
  - Compact list: `#BIB Name (Division)`
  - Collapsed by default if > 10 entries, with "Show all N" toggle

### 3.4 Types

- [ ] `src/types/index.ts` — define and export all shared types:
  - `RawResult`, `PassingData`, `LegPassingStats`
  - `AthleteSearchResult`, `AthleteAnalysisResponse`
  - `RaceListItem`, `RaceDetail`

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

- [ ] Add Next.js `cache()` or `unstable_cache` to race list and race detail reads (data doesn't change)
- [ ] Set `Cache-Control: public, max-age=3600` on public API routes
- [ ] Confirm athlete search is fast on a real 3000-athlete dataset

### 4.3 Deploy

- [ ] Create Vercel project, connect GitHub repo
- [ ] Set environment variables in Vercel dashboard:
  - `DATABASE_URL`
  - `DIRECT_URL`
  - `ADMIN_SECRET`
  - `NEXT_PUBLIC_APP_URL`
- [ ] Run production migration:
  ```bash
  pnpm prisma migrate deploy
  ```
- [ ] Upload a real Ironman CSV via the deployed admin UI
- [ ] Smoke test: find a known athlete, verify ranks and passing stats against source

---

## Verification Checklist

Before shipping Phase 3/4:

- [ ] `pnpm test` — all unit tests pass
- [ ] `pnpm typecheck` — zero TypeScript errors
- [ ] `pnpm lint` — zero lint errors
- [ ] Upload a real Ironman CSV (≥500 athletes) — import completes cleanly
- [ ] Search for an athlete by name and by bib — both work
- [ ] Open athlete analysis — all split times and ranks display correctly
- [ ] Verify passing math:
  - Pick one athlete, manually compute their after-swim rank from raw data
  - Cross-check `afterSwimRank` in DB matches
  - Verify "gained" count on the bike matches expected field cross-reference
- [ ] Invariant check: `sum of gained === sum of lost` across all athletes in a race
  (write a one-off script `scripts/verify-passing.ts` to assert this)
- [ ] Mobile layout looks correct at 375px
- [ ] DNF athlete: their `passingData` stops at the leg they dropped, all subsequent legs are null/zero
