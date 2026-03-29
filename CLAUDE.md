# RaceReplay

## What this is
RaceReplay is a public web service for endurance race results analysis. Users search for any athlete across any uploaded race and see a leg-by-leg "passing analysis": how many athletes they passed — and who specifically — during each segment (swim, T1, bike, T2, run).

## Stack
- **Framework:** Next.js 15 (App Router) — UI + API routes in one codebase
- **Language:** TypeScript throughout
- **Database:** PostgreSQL via Supabase, ORM is Prisma (schema at `prisma/schema.prisma`)
- **Styling:** Tailwind CSS + shadcn/ui
- **Deployment:** Vercel
- **Package manager:** pnpm
- **Tests:** Vitest

## Repo structure
```
racereplay/
├── prisma/
│   ├── schema.prisma       Data model (source of truth)
│   └── migrations/
├── src/
│   ├── app/                Next.js App Router pages + API routes
│   │   ├── page.tsx        Home — list races
│   │   ├── [raceSlug]/     Race + athlete pages
│   │   ├── admin/          Admin upload UI
│   │   └── api/            API route handlers
│   ├── lib/
│   │   ├── prisma.ts       Prisma singleton
│   │   ├── csv-parser.ts   CSV → RawResult[] with flexible column mapping
│   │   ├── passing-calc.ts Core passing algorithm (pure function)
│   │   ├── time-utils.ts   HH:MM:SS ↔ seconds
│   │   └── admin-auth.ts   ADMIN_SECRET header check
│   ├── components/         React components
│   └── types/index.ts      Shared TypeScript types
└── .env.local              Not committed — see .env.example
```

## Key commands
```bash
pnpm dev          # start dev server on localhost:3000
pnpm build        # production build
pnpm test         # run Vitest tests
pnpm typecheck    # tsc --noEmit
pnpm lint         # ESLint
```

## Database
Schema at `prisma/schema.prisma`. Run migrations from the repo root:
```bash
pnpm prisma migrate dev --name <migration-name>
pnpm prisma generate
```

## Environment variables
See `.env.example`. Key vars:
- `DATABASE_URL` — Supabase pooled connection (PgBouncer, for runtime)
- `DIRECT_URL` — Supabase direct connection (migrations only)
- `ADMIN_SECRET` — arbitrary secret for protecting admin upload endpoints

Never commit `.env.local`.

## Admin upload
- Navigate to `/admin/upload`
- Provide the `ADMIN_SECRET` in the form
- Select or create a race, upload a CSV
- The import pipeline parses, stores, and pre-computes all passing data in one request

## Code conventions
- All split times stored as integer **seconds** in the DB; display conversion (`HH:MM:SS`) happens at the component/API response layer
- Passing stats are **pre-computed** at import time and stored as JSONB in `result.passingData` — never re-derived at query time
- DNF/DNS/DSQ athletes are excluded from rankings at and after the leg they dropped
- Admin protection is a simple `x-admin-secret` header check — no full auth system
- T1 and T2 are treated as individual scoreable "legs" (not folded into swim/bike)

## Planning docs
All design documents live in `/docs`:

| File | Contents |
|---|---|
| `docs/PRD.md` | Product requirements, feature scope |
| `docs/ARCHITECTURE.md` | System design, data flow, infrastructure |
| `docs/DATA_MODEL.md` | Full Prisma schema with design decisions |
| `docs/API_SPEC.md` | All API routes, request/response shapes |
| `docs/IMPLEMENTATION_PLAN.md` | Phased build plan with task checklists |
