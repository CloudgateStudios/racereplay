# RaceReplay

RaceReplay calculates how many people each athlete physically passes (and gets passed by) in every leg of a race — swim, bike, run, or any custom timing segment — and publishes those results on a public website.

It supports any race with per-athlete timing data from RTRT.me, including triathlons, road races, and trail runs.

---

## How It Works

Traditional race results only show finish position and chip time. RaceReplay answers a different question: **who did you actually race past on course?**

In a time-trial start race (athletes enter one at a time), raw chip times don't tell you who was physically ahead. RaceReplay uses per-athlete start epoch times from RTRT.me to compute each athlete's absolute position at every timing checkpoint, then compares athletes head-to-head to count physical passes.

For each leg and each athlete, RaceReplay reports:
- How many athletes they **passed**
- How many athletes **passed them**
- Their **net** (passed minus got passed)

---

## Architecture

```
scripts/          ← Local data pipeline (run on your machine)
  fetch-*.mjs     ← Pull race data from competitor.com and RTRT.me
  analyze-*.mjs   ← Run the passing algorithm, write _passing.csv
  test-*.mjs      ← Unit tests for the algorithm

app/              ← Next.js web application
  prisma/         ← Database schema and migrations
  scripts/        ← Ingest script (load _passing.csv into the database)
  src/app/        ← Pages and UI components
```

Data flows one way: run the pipeline scripts locally → ingest the CSV → the website reads from the database.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Database | PostgreSQL via Neon (serverless) |
| ORM | Prisma 7 with `@prisma/adapter-pg` |
| UI | shadcn/ui + Tailwind CSS v4 |
| Hosting | Vercel |
| Local DB | Docker (PostgreSQL on port 5433) |

---

## Data Model

```
Race (slug, name)
  └── Event (year, type, date)
        ├── Segment (name, displayOrder)
        └── Athlete (bib, name, gender, division, ranks)
              └── AthleteSegment (timeSeconds, gained, lost, net)
```

A `Race` groups all years of the same event under one slug. An `Event` is one year of one race. `Segment` is a leg (e.g. Swim, T1, Bike, T2, Run). `AthleteSegment` holds the passing counts for one athlete in one leg.

Supported event types: `TRIATHLON`, `ROAD_RACE`.

---

## URL Structure

```
/                               → All races
/events/[slug]                  → Race landing page (year picker)
/events/[slug]/[year]           → Athlete table (search, filter, sort)
/events/[slug]/[year]/[bib]     → Athlete detail (leg-by-leg breakdown)
```

---

## Local Development

### Prerequisites

- Node.js 20+
- Docker (for local PostgreSQL)

### Setup

```bash
# 1. Start the local database
docker run -d \
  --name racereplay-db \
  -e POSTGRES_PASSWORD=postgres \
  -p 5433:5432 \
  postgres:16

# 2. Install dependencies
cd app
npm install

# 3. Create your local env file
echo 'DATABASE_URL=postgresql://postgres:postgres@localhost:5433/racetrace' > .env.local

# 4. Run migrations
npx prisma migrate deploy

# 5. Start the dev server
npm run dev
```

The app will be running at `http://localhost:3000`. It will show an empty race list until you ingest data.

---

## Data Pipeline

The pipeline runs locally and produces a `_passing.csv` file that gets loaded into the database.

### Workflow A — Any RTRT-tracked race (road races, triathlons, etc.)

```bash
# Fetch splits and start times
node scripts/fetch-rtrt-event.mjs <event-id> [--appid <id>]

# Run the passing algorithm
node scripts/analyze-passing.mjs scripts/data/<EVENT-ID>.csv \
  --rtrt-starts scripts/data/<event-id>_starts.csv
```

The event ID comes from the RTRT tracking URL: `https://track.rtrt.me/e/<EVENT-ID>`.

For non-IRONMAN races, find the app ID by viewing page source and searching for `"appid"`.

### Workflow B — IRONMAN races (competitor.com + RTRT)

```bash
# Fetch official results from competitor.com
node scripts/fetch-race.mjs <competitor-url> <year>

# Fetch per-athlete start times from RTRT
node scripts/fetch-rtrt-starts.mjs <rtrt-event-id>

# Run the passing algorithm
node scripts/analyze-passing.mjs scripts/data/<results>.csv \
  --rtrt-starts scripts/data/<event-id>_starts.csv
```

See [scripts/README.md](scripts/README.md) for full details on both workflows, including how to find event URLs and IDs.

### Ingest into the database

Once you have a `_passing.csv`, load it into the database:

```bash
cd app
npx tsx scripts/ingest.ts ../scripts/data/<file>_passing.csv \
  --slug <slug> \
  --race-name "<Race Name>" \
  --year <YYYY> \
  --event-type <triathlon|road_race> \
  --event-date <YYYY-MM-DD>
```

The ingest script is fully idempotent — running it twice on the same file is safe.

To load into the Neon dev database instead of local Docker, prefix with the connection string:

```bash
DATABASE_URL="postgresql://..." npx tsx scripts/ingest.ts ...
```

---

## npm Scripts

Run these from the `app/` directory.

| Script | Command | Purpose |
|---|---|---|
| `npm run dev` | `next dev --turbopack` | Start local dev server |
| `npm run build` | `next build` | Production build |
| `npm run lint` | `eslint` | Lint all files |
| `npm run format` | `prettier --write .` | Format all files |
| `npm run format:check` | `prettier --check .` | Check formatting (used in CI) |

---

## Deployment

Two environments are managed via GitHub Actions:

### Dev

Deploys automatically on every push to `main`. Targets the Neon `dev` database branch and Vercel's preview environment.

### Prod

Manual deploy via **Actions → Deploy Prod → Run workflow**. Requires a semver version tag as input (e.g. `v1.0.0`). Checks out that exact tag, runs migrations against the Neon production database, deploys to Vercel production, and creates a GitHub Release.

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `VERCEL_TOKEN` | Vercel API token |
| `VERCEL_ORG_ID` | Vercel organization ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |
| `DATABASE_URL_DEV` | Neon dev branch connection string (set on `dev` environment) |
| `DATABASE_URL_PROD` | Neon prod branch connection string (set on `prod` environment) |

---

## CI

Every pull request to `main` runs three checks:

| Check | What it does |
|---|---|
| Validate PR Title | Enforces semantic commit format (`feat:`, `fix:`, `ci:`, etc.) |
| Validate Spelling | cspell on all `.ts`, `.tsx`, `.css`, `.md`, `.yaml` files |
| Validate Code | Prisma validate → tsc → ESLint → Prettier → depcheck → next build |

Dependabot runs weekly and groups dependency updates into bundled PRs.

---

## Spelling Dictionaries

Two custom cspell dictionaries live in `.cspell/`:

- `dev_dictionary.txt` — framework and stack terms (Prisma, Neon, shadcn, Tailwind, etc.)
- `triathlon_dictionary.txt` — race and sport terms (triathlon, ironman, bib, DNF, T1, T2, etc.)

To add a new word, put it in whichever file fits and commit.

---

## Adding a New Race

1. Run the data pipeline scripts to produce a `_passing.csv`
2. Choose a URL slug (e.g. `ironman-chattanooga-703`)
3. Run the ingest script against the target database
4. The race appears on the home page immediately — no code changes needed
