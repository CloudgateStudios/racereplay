# Race Replay — Feature Enhancements

Improvements to existing functionality. These build on what's already there
without requiring new pages or major architecture changes.

---

## 2. Richer SEO and social metadata

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

## 3. Manual dark mode toggle

**Current behavior:** Dark mode follows the system `prefers-color-scheme` media
query. There is no way for a user to manually override this.

**Enhancement:** Add a theme toggle button to the header (sun/moon icon). Store
the preference in `localStorage` and apply a `dark` class to the `<html>` element
on load to avoid flash of wrong theme.

**Files:** `app/src/app/layout.tsx`, new `ThemeToggle` client component.

---

## 4. Athlete funnel visualization improvements

**Current behavior:** The event page shows a simple "Started → [Segments] →
Finished" funnel as text badges with counts.

**Enhancement:**

- Add percentage labels next to each count (e.g. "4,821 — 94.2%").
- Visually highlight the segment with the highest DNF/dropout rate.
- Consider a simple bar or step chart for events with large fields.

**Files:** `app/src/app/events/[slug]/[year]/page.tsx`

---

## 5. Shareable athlete result links

**Current behavior:** The athlete detail page URL (`/events/[slug]/[year]/[bib]`)
is already deep-linkable, but there is no share button or clipboard copy action
anywhere.

**Enhancement:** Add a "Share" button on the athlete detail page that copies the
current URL to the clipboard. Combine with og:image generation (see item 2) so
shared links render a rich preview in iMessage, Slack, Twitter, etc.

**Files:** `app/src/app/events/[slug]/[year]/[bib]/page.tsx`

---

## 6. Persistent filter state via URL

**Current behavior:** Gender, division, search, sort, and page are all stored in
URL search params, which is correct. However, navigating to an athlete detail
page and pressing Back resets all filters.

**Enhancement:** This is actually already handled by the browser Back button
since state lives in the URL — but verify that the Back button correctly restores
the full filter state (including page number) and that no `router.replace` calls
are accidentally clearing params on mount.

**Files:** `app/src/app/events/[slug]/[year]/filters.tsx`,
`app/src/app/events/[slug]/[year]/sort-header.tsx`
