# Race Replay — Tech Debt

Issues in the existing codebase that should be addressed to improve correctness,
maintainability, and resilience. Ordered from highest to lowest priority.

---

## High Priority

### 1. Duplicate utility functions

**Files affected:**
- `app/src/app/events/[slug]/[year]/page.tsx`
- `app/src/app/events/[slug]/[year]/[bib]/page.tsx`

**Problem:** Net color logic (`text-green-600` / `text-red-500`), net label
formatting, and `formatSeconds()` are copy-pasted across both pages. Any change
to display behavior must be made in two places.

**Fix:** Extract to `app/src/lib/utils.ts` alongside the existing `cn()` helper:
```ts
export function netColorClass(net: number | null): string
export function formatSeconds(seconds: number | null): string
```

---

### 2. Finish time sentinel string

**Files affected:**
- `app/src/app/events/[slug]/[year]/[bib]/page.tsx` (line ~128)
- `scripts/ingest.ts`

**Problem:** Invalid finish times are stored in the database as the literal string
`"--:--:--"`. The UI checks `athlete.finishTime !== "--:--:--"` to decide whether
to display a value. This is fragile — any variation in the sentinel (spacing,
dashes) silently breaks the display.

**Fix:** Change `finishTime` in the Prisma schema to `String?` (nullable). Store
`null` for missing/invalid times. Update all display code to check `!= null`.

---

### 3. Finish segment string matching

**Files affected:**
- `app/src/app/events/[slug]/[year]/page.tsx` (line ~187)

**Problem:** The athlete funnel filters out the finish segment with:
```ts
.filter((seg) => seg.name.toLowerCase() !== "finish")
```
This breaks if the segment is named "Finish Line", "FINAL", or anything else.

**Fix:** Add a boolean `isFinish` field to the `Segment` model, set during
ingest. The filter becomes `.filter((seg) => !seg.isFinish)`.

---

### 4. No error boundaries

**Problem:** No `error.tsx` files exist anywhere in the app. A failed database
query or unexpected data shape produces a blank white screen with no user-facing
message.

**Fix:** Add error boundary files at:
- `app/src/app/error.tsx` — global fallback
- `app/src/app/events/[slug]/[year]/error.tsx` — event page fallback
- `app/src/app/events/[slug]/[year]/[bib]/error.tsx` — athlete page fallback

---

### 5. Division whitespace / phantom filter categories

**Files affected:**
- `app/src/app/events/[slug]/[year]/page.tsx` (line ~94)
- `scripts/ingest.ts`

**Problem:** The division filter checks `division: { not: "" }` to determine
whether to show the division column. Whitespace-only strings (`" "`) pass this
check and create phantom filter options. Typos during ingest (e.g. `"M 40-4"` vs
`"M 40-44"`) also create duplicate categories.

**Fix:**
1. Trim all string fields (name, gender, division, status) in the ingest script
   before writing to the database.
2. Change the `hasDivisions` check to `division: { not: { in: ["", " "] } }` or
   use a more robust trim-aware query.

---

### 6. Gender, division, and status are unconstrained strings

**File affected:** `prisma/schema.prisma`

**Problem:** `gender`, `division`, and `status` on the `Athlete` model are plain
`String` fields with no validation. Typos in CSV data create phantom filter
options that persist in the database forever.

**Fix:**
- Add `status` as a Prisma enum (`FIN | DNF | DSQ | DNS`).
- Consider a lookup/reference table for divisions, or at minimum enforce
  trimming and casing normalization in the ingest script.

---

### 7. DATABASE_URL non-null assertion crashes late

**File affected:** `app/src/lib/prisma.ts`

**Problem:**
```ts
connectionString: process.env.DATABASE_URL!
```
The `!` suppresses TypeScript's undefined warning. If `DATABASE_URL` is missing,
the error surfaces at first query time rather than at app startup, making
diagnosis harder.

**Fix:** Add an explicit check at module load time:
```ts
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}
```

---

### 8. Ingest script assumes exact CSV column names

**File affected:** `scripts/ingest.ts`

**Problem:** The script hard-codes column names like `"Overall Finish Time"`,
`"Finish Time"`, and `"Wave Offset (Seconds)"`. Any variation in the source CSV
silently drops data or throws an unhandled error.

**Fix:**
- Accept column name overrides as optional CLI flags (e.g. `--finish-col`).
- Log a warning when expected columns are not found rather than silently skipping.
- Add a `--dry-run` flag that prints detected columns and leg names before
  writing to the database.

---

## Lower Priority

### 9. Rank card layout instability on athlete page

**File affected:** `app/src/app/events/[slug]/[year]/[bib]/page.tsx`

**Problem:** Rank cards (Overall, Gender, Division) only render if the value is
non-null. A missing division rank causes the other two cards to reflow into a
different grid shape.

**Fix:** Always render all three cards. Show `"N/A"` or `"—"` for null values
instead of hiding the card entirely.

---

### 10. No loading states for async pages

**Problem:** All event and athlete pages use `force-dynamic` with no Suspense
boundaries or `loading.tsx` files. The page shows nothing until all data is
fetched.

**Fix:** Add `loading.tsx` files with skeleton placeholders for:
- `app/src/app/events/[slug]/[year]/loading.tsx`
- `app/src/app/events/[slug]/[year]/[bib]/loading.tsx`

---

### 11. Search input fires on every keystroke

**File affected:** `app/src/app/events/[slug]/[year]/filters.tsx`

**Problem:** The `onChange` handler calls `updateParam()` (which calls
`router.push`) on every keystroke. `useTransition` makes this non-blocking but
the URL updates on every character, which is noisy and can cause excessive
re-renders under fast typing.

**Fix:** Add a 150–200ms debounce to the search input before pushing to the
router.

---

### 12. No tests

**Problem:** There are no unit or integration tests anywhere in the project.
The ingest script in particular has complex parsing and concurrency logic with no
test coverage.

**Fix (incremental):**
1. Add unit tests for `formatSeconds`, `netColorClass`, and the CSV column
   detection logic in `ingest.ts`.
2. Add an integration test for the ingest script against a small fixture CSV.
3. Consider Playwright for end-to-end tests on the main pages.
