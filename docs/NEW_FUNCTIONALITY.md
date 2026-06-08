# Race Replay — New Functionality

Net-new features that don't exist yet. Each one requires new pages, components,
or data structures beyond what's currently in place.

> **See also:** `PLANNING.md` for the full ideation backlog including tech debt,
> schema migration planning, and feature enhancements.

---

## ✅ Shipped

- **Athlete comparison view** — `/events/[slug]/[year]/compare` (PR #68)
- **Multi-year race history** — Race History table on athlete detail page (PR #70)

---

## 1. Per-segment leaderboard

**Description:** A "Best splits" view for an event — who had the fastest bike
leg, fastest swim, fastest run — ranked independently from overall finish.

**Why it's valuable:** Shows discipline specialists (e.g. the fastest swimmer who
had a slow run) and gives athletes context for how their individual legs compare
to the field.

**Approach:**
- Tab or sub-page on the event page: `/events/[slug]/[year]?view=splits`
- One table per segment, sorted by `timeSeconds` ascending.
- Show rank within segment, athlete name/bib, time, and overall finish rank for
  context.
- Could also show "most passes in a single leg" as a separate leaderboard.

**New files / changes:**
- New view mode in `app/src/app/events/[slug]/[year]/page.tsx` or a separate
  `splits/page.tsx`

---

## 3. CSV / data export

**Description:** A "Download results" button on the event results page that
exports the currently filtered and sorted view as a CSV file.

**Why it's valuable:** Athletes and coaches want to do their own analysis.
Providing a clean export removes friction and makes the tool more useful as a
data source.

**Approach:**
- Add a Route Handler at `app/src/app/api/events/[slug]/[year]/export/route.ts`
  that accepts the same filter/sort params as the results page and returns a CSV.
- Button on the results page that links to the export URL with current params
  forwarded.
- Include all columns: Bib, Name, Division, Gender, Status, Finish Time,
  per-segment Gained/Lost/Net, Overall Net.

---

## 4. Race series / multi-year athlete tracking

**Status:** Schema foundation landed (PR #69 — `normalizedName` on Athlete).
Race history UI landed (PR #70). Remaining work: year-over-year delta callouts.

**Schema dependency:** None remaining for the history table. `AthleteProfile`
model (see PLANNING.md S3) needed for full cross-race profile page.

---

## 5. Race search / discovery page

**Description:** A search bar on the home page (or a dedicated `/search` page)
that lets users find a specific race by name, location, or year.

**Why it's valuable:** As the number of races in the database grows, the "Latest
races" cards on the home page won't be enough. Users need a way to find their
specific event.

**Approach:**
- Full-text search over `Race.name` and `Event.year`.
- Could be as simple as a client-side filter over the full race list (works until
  ~500 races).
- For larger scale: Postgres full-text search or a search index.

**Schema dependency:** PLANNING.md S1 (race location/series fields) makes this
significantly more useful.

---

## 6. Athlete profile page (cross-race)

**Description:** A page for an athlete that aggregates their results across all
events in the database.

**Why it's valuable:** An athlete who has done multiple races in the system could
see their passing stats across all of them in one place — their "Race Replay
profile."

**Approach:**
- URL: `/athletes/[id]` keyed by `AthleteProfile.id` or `normalizedName`.
- Shows all events the athlete has completed with overall net passes, finish time,
  and rank.

**Schema dependency:** PLANNING.md S3 (`AthleteProfile` model) recommended before
building this — provides a stable URL key and deduplication.

---

## 7. Admin / ingest UI

**Description:** A password-protected admin page for uploading new race CSVs and
triggering ingestion without needing direct CLI access to the server.

**Why it's valuable:** Currently adding a new race requires SSH access and running
a terminal command. An admin UI would allow adding races from a browser.

**Approach:**
- Simple password protection via a `ADMIN_SECRET` env var checked in middleware.
- File upload form that accepts a CSV.
- Calls a server action or API route that runs the ingest logic.
- Shows ingestion progress and a summary on completion.

**New files:**
- `app/src/app/admin/page.tsx`
- `app/src/app/admin/actions.ts` (server actions)
- `app/src/middleware.ts` (auth check)
