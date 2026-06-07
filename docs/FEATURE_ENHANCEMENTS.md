# Race Replay — Feature Enhancements

Improvements to existing functionality. These build on what's already there
without requiring new pages or major architecture changes.

---

## 1. Search debounce on event results page

**Current behavior:** The search box in the event results table fires a
`router.push` on every keystroke. `useTransition` keeps it non-blocking, but
typing quickly still produces a noisy URL history and can feel jittery.

**Enhancement:** Add a 150–200ms debounce before pushing the search value to
the URL. This is a one-line change with a small `useDebounce` hook.

**Files:** `app/src/app/events/[slug]/[year]/filters.tsx`

---

## 2. Mobile table layout

**Current behavior:** The results table on the event page is a full-width
horizontal scroll on mobile. There is no indicator that more columns exist off
screen, and the passing/lost/net columns are easy to miss.

**Enhancement options (pick one or layer them):**
- Show only the most important columns on mobile (Rank, Name, Overall Net) and
  reveal the rest behind a toggle or horizontal scroll with a fade indicator.
- Switch to a card layout on small screens where each athlete is a stacked card
  showing their key stats.
- Add a sticky first column (Rank or Name) so the athlete identity stays visible
  while scrolling right.

**Files:** `app/src/app/events/[slug]/[year]/page.tsx`

---

## 3. Skeleton loading screens

**Current behavior:** All event and athlete pages are fully server-rendered with
`force-dynamic`. The page shows nothing until the database query completes.

**Enhancement:** Add `loading.tsx` files alongside the main pages with skeleton
placeholders that match the layout. This gives instant visual feedback and makes
slow queries feel faster.

**Files to add:**
- `app/src/app/events/[slug]/[year]/loading.tsx`
- `app/src/app/events/[slug]/[year]/[bib]/loading.tsx`

---

## 4. Richer SEO and social metadata

**Current behavior:** Pages have basic `<title>` tags. No `description`,
`og:image`, or structured data.

**Enhancement:**
- Add per-page `description` metadata (event name, date, athlete count).
- Add `og:image` generation via Next.js's `ImageResponse` for event and athlete
  pages — a simple card showing the race name, year, and athlete name/bib would
  make shared links much more compelling.
- Add `schema.org` `SportsEvent` structured data on event pages for better
  search engine understanding.

**Files:** All `page.tsx` files that export `metadata`.

---

## 5. Manual dark mode toggle

**Current behavior:** Dark mode follows the system `prefers-color-scheme` media
query. There is no way for a user to manually override this.

**Enhancement:** Add a theme toggle button to the header (sun/moon icon). Store
the preference in `localStorage` and apply a `dark` class to the `<html>` element
on load to avoid flash of wrong theme.

**Files:** `app/src/app/layout.tsx`, new `ThemeToggle` client component.

---

## 6. Athlete funnel visualization improvements

**Current behavior:** The event page shows a simple "Started → [Segments] →
Finished" funnel as text badges with counts.

**Enhancement:**
- Add percentage labels next to each count (e.g. "4,821 — 94.2%").
- Visually highlight the segment with the highest DNF/dropout rate.
- Consider a simple bar or step chart for events with large fields.

**Files:** `app/src/app/events/[slug]/[year]/page.tsx`

---

## 7. Shareable athlete result links

**Current behavior:** The athlete detail page URL (`/events/[slug]/[year]/[bib]`)
is already deep-linkable, but there is no share button or clipboard copy action
anywhere.

**Enhancement:** Add a "Share" button on the athlete detail page that copies the
current URL to the clipboard. Combine with og:image generation (see item 4) so
shared links render a rich preview in iMessage, Slack, Twitter, etc.

**Files:** `app/src/app/events/[slug]/[year]/[bib]/page.tsx`

---

## 8. Persistent filter state via URL

**Current behavior:** Gender, division, search, sort, and page are all stored in
URL search params, which is correct. However, navigating to an athlete detail
page and pressing Back resets all filters.

**Enhancement:** This is actually already handled by the browser Back button
since state lives in the URL — but verify that the Back button correctly restores
the full filter state (including page number) and that no `router.replace` calls
are accidentally clearing params on mount.

**Files:** `app/src/app/events/[slug]/[year]/filters.tsx`,
`app/src/app/events/[slug]/[year]/sort-header.tsx`
