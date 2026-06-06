# RaceReplay — Build Plan

A public website that ingests pre-computed race passing data and lets anyone
browse athletes, sort/filter results, and see how many people each participant
passed (or got passed by) in every leg of a race.

---

## Architecture

### Hosting & Cost
- **Frontend + API:** Next.js 15 (App Router) deployed on **Vercel** (Hobby — free)
- **Database:** Neon serverless PostgreSQL (free tier — 0.5 GB, no always-on server cost)
- **Estimated monthly cost:** ~$0 until meaningful traffic

### Stack
- Next.js 15 (App Router)
- Prisma ORM
- Neon (PostgreSQL)
- Tailwind CSS + shadcn/ui
- TypeScript

### Data Flow
```
Local scripts (existing) → _passing.csv → scripts/ingest.mjs → Neon DB → Next.js website
```

All data prep happens locally. The website is read-only — it just queries the DB.

---

## URL Structure

```
/                              → all races, grouped and listed
/events/[slug]                 → race landing page — shows available years
/events/[slug]/[year]          → athlete table for that race + year
/events/[slug]/[year]/[bib]    → individual athlete detail page
```

Slugs are set manually at ingest time (e.g. `im-703-chattanooga`, `shamrock-shuffle`).

---

## Database Schema

```
Race
  id          Int       PK
  slug        String    unique  (e.g. "im-703-chattanooga")
  name        String            (e.g. "IM 70.3 Chattanooga")

Event
  id          Int       PK
  race_id     Int       FK → Race
  year        Int
  type        Enum      (TRIATHLON | ROAD_RACE)
  date        Date
  unique(race_id, year)

Segment
  id          Int       PK
  event_id    Int       FK → Event
  name        String    (e.g. "Swim", "T1", "Bike", "Run", "5K", "Finish")
  display_order Int

Athlete
  id          Int       PK
  event_id    Int       FK → Event
  bib         String
  name        String
  gender      String
  division    String
  country     String
  status      String    (FIN, DNF, etc.)
  finish_time String
  overall_rank    Int nullable
  gender_rank     Int nullable
  division_rank   Int nullable
  unique(event_id, bib)

AthleteSegment
  id          Int       PK
  athlete_id  Int       FK → Athlete
  segment_id  Int       FK → Segment
  time_seconds Float nullable
  gained      Int nullable
  lost        Int nullable
  net         Int nullable
  unique(athlete_id, segment_id)
```

---

## Ingest Script

**Location:** `scripts/ingest.mjs`

**Usage:**
```bash
node scripts/ingest.mjs <passing-csv> \
  --slug <slug> \
  --race-name "<Human Readable Name>" \
  --year <YYYY> \
  --event-type <triathlon|road_race> \
  --event-date <YYYY-MM-DD>
```

**Example:**
```bash
node scripts/ingest.mjs scripts/data/IRM-CHATTANOOGA703-2026_passing.csv \
  --slug im-703-chattanooga \
  --race-name "IM 70.3 Chattanooga" \
  --year 2026 \
  --event-type triathlon \
  --event-date 2026-05-18
```

**Behavior:**
- Upserts Race by slug (safe to re-run)
- Upserts Event by (slug, year)
- Detects legs automatically from CSV column headers (any `* Time` column)
- Detects gained/lost/net columns automatically per leg
- Skips bib lists entirely (those columns are ignored)
- Safe to re-run if CSV is regenerated — all upserts

---

## Website Pages

### `/` — Race List
- Cards for each Race (grouped, not per-year)
- Each card shows race name, available years, event type
- Links to `/events/[slug]`

### `/events/[slug]` — Race Landing
- Shows race name and a list of years with a summary (athlete count, date)
- Links to `/events/[slug]/[year]`

### `/events/[slug]/[year]` — Athlete Table
- Full sortable/searchable table of all athletes
- Columns: Rank, Bib, Name, Division, Status, Finish Time, then per-leg Gained/Lost/Net, Overall Net
- Search by name or bib
- Filter by gender, division
- Sort by any column
- Each row links to `/events/[slug]/[year]/[bib]`

### `/events/[slug]/[year]/[bib]` — Athlete Detail
- Athlete name, bib, division, finish time, overall/gender/division rank
- Per-leg breakdown table: Leg | Time | Passed | Got Passed | Net
- Overall net passes

---

## Build Steps

### Step 1 — Clean slate
- [ ] Remove any leftover Next.js scaffold files from phase 1
- [ ] Reset Prisma schema to match the schema above
- [ ] Confirm Neon DB connection works

### Step 2 — Prisma schema + migration
- [ ] Write new `schema.prisma` with all models above
- [ ] Run `prisma migrate dev` to apply to Neon
- [ ] Generate Prisma client

### Step 3 — Ingest script
- [ ] Write `scripts/ingest.mjs`
- [ ] Test with `IRM-CHATTANOOGA703-2026_passing.csv`
- [ ] Test with `BASS2026_passing.csv` (road race — different leg structure)
- [ ] Verify re-run is idempotent

### Step 4 — Load existing data
- [ ] Ingest all existing `_passing.csv` files in `scripts/data/`
- [ ] Confirm row counts and spot-check a few athletes

### Step 5 — Next.js app foundation
- [ ] Install and configure Tailwind + shadcn/ui
- [ ] Set up Prisma client singleton for Next.js
- [ ] Create shared layout (nav, footer)

### Step 6 — Race list page (`/`)
- [ ] Fetch all races with year counts
- [ ] Render race cards

### Step 7 — Race landing page (`/events/[slug]`)
- [ ] Fetch race + all events for that slug
- [ ] Render year list with athlete counts and dates

### Step 8 — Athlete table page (`/events/[slug]/[year]`)
- [ ] Fetch all athletes + segment data for event
- [ ] Render sortable table
- [ ] Add search (name/bib), filter (gender/division), sort

### Step 9 — Athlete detail page (`/events/[slug]/[year]/[bib]`)
- [ ] Fetch single athlete + all segment data
- [ ] Render per-leg breakdown

### Step 10 — Deploy
- [ ] Push to GitHub
- [ ] Connect repo to Vercel
- [ ] Add Neon `DATABASE_URL` to Vercel env vars
- [ ] Confirm production build works
- [ ] (Later) Add custom domain

---

## Notes

- The `_passing.csv` bib list columns (`* Passed Bibs`, `* Passed By Bibs`) are
  intentionally ignored during ingest — only counts (Gained/Lost/Net) are stored.
- The ingest script auto-detects legs from CSV headers so it works for any race
  type without configuration beyond the CLI flags.
- Wave Offset is stored nowhere — it's an internal algorithm detail, not useful
  to display on the site.
