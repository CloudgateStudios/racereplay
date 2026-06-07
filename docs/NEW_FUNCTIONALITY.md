# Race Replay — New Functionality

Net-new features that don't exist yet. Each one requires new pages, components,
or data structures beyond what's currently in place.

---

## 1. Athlete comparison view

**Description:** Select two athletes from the same event and see a side-by-side
leg breakdown — who gained more on the bike, who closed the gap on the run, and
where the race was won or lost.

**Why it's valuable:** The most common question after a race is "how did I do vs
[training partner / age group rival]?" The data to answer this already exists.

**Approach:**
- URL: `/events/[slug]/[year]/compare?a=[bib1]&b=[bib2]`
- A "Compare" button on the athlete detail page that lets you pick a second
  athlete (search by name/bib).
- Side-by-side table: each row is a leg, each column is an athlete. Delta column
  shows the difference in net passes per leg.
- Color-code the winner of each leg.

**New files:**
- `app/src/app/events/[slug]/[year]/compare/page.tsx`
- Athlete picker component (reusable search/select)

---

## 2. Per-segment leaderboard

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

**Description:** If an athlete has competed in the same race across multiple
years, show a "Your history" section on the athlete detail page with year-over-year
comparisons.

**Why it's valuable:** Repeat participants (common in triathlons) want to know if
they're improving. "You passed 12 more people on the bike than last year" is a
compelling data point.

**Approach:**
- Match athletes across years by name (fuzzy) or by a stable identifier if
  available in the CSV.
- On the athlete detail page, if prior-year records are found, show a small
  year-over-year summary card.
- This requires some tolerance for name variations — consider a normalized name
  field on `Athlete` set during ingest.

**Schema change:** Add `normalizedName String?` to `Athlete`.

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

**New files:**
- Search input component on `app/src/app/page.tsx` or new
  `app/src/app/search/page.tsx`

---

## 6. Athlete profile page (cross-race)

**Description:** A page for an athlete that aggregates their results across all
events in the database.

**Why it's valuable:** An athlete who has done multiple races in the system could
see their passing stats across all of them in one place — their "Race Replay
profile."

**Approach:**
- URL: `/athletes/[normalized-name]` or keyed by a stable ID if one exists.
- Shows all events the athlete has completed with overall net passes, finish time,
  and rank.
- Requires the normalized name matching from item 4 above.

**New files:**
- `app/src/app/athletes/[id]/page.tsx`
- Schema change: stable athlete identifier or normalized name

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
