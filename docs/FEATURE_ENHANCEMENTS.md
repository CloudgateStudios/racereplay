# Race Replay — Feature Enhancements

Improvements to existing functionality. These build on what's already there
without requiring new pages or major architecture changes.

---

## 2. Richer SEO and social metadata ✅ Complete

**Implemented in PR #61.**

- Per-page `description` metadata on all routes.
- Dynamic `og:image` generation via `next/og` (`ImageResponse`) for all pages —
  default branded card, race series card, event card, and athlete card.
- Shared `OgCard` component (`src/lib/og-card.tsx`) and `loadOgFonts` helper
  (`src/lib/og-fonts.ts`) — Barlow Condensed loaded from Google Fonts.
- `schema.org` `SportsEvent` JSON-LD structured data on event pages.
- Consistent hex+play logo across header and all OG images.

---

## 3. Manual dark mode toggle

**Current behavior:** Dark mode follows the system `prefers-color-scheme` media
query. There is no way for a user to manually override this.

**Enhancement:** Add a theme toggle button to the header (sun/moon icon). Store
the preference in `localStorage` and apply a `dark` class to the `<html>` element
on load to avoid flash of wrong theme.

**Files:** `app/src/app/layout.tsx`, new `ThemeToggle` client component.

---

## 4. Athlete funnel visualization improvements ⚠️ Partially complete

**What's done:** Percentage labels next to each segment count were added in PR #58.

**Still to do:**

- Visually highlight the segment with the highest DNF/dropout rate.
- Consider a simple bar or step chart for events with large fields.

**Files:** `app/src/app/events/[slug]/[year]/funnel.tsx`

---

## 5. Shareable athlete result links ⚠️ Partially complete

**What's done:** OG images are implemented (PR #61) — shared links render rich
previews in iMessage, Slack, Twitter, etc., showing athlete name, finish time,
and overall net passes.

**Still to do:** Add a "Share" button on the athlete detail page that copies the
current URL to the clipboard.

**Files:** `app/src/app/events/[slug]/[year]/[bib]/page.tsx`

---

## 6. Persistent filter state via URL ✅ Complete (verified)

**Verified working** — all filter state (gender, division, search, sort, page)
lives in URL search params. Navigating to an athlete detail page and pressing
Back correctly restores the full filter state. No mount-time param clearing
exists in `filters.tsx` or `sort-header.tsx`.

**Note:** Gender values are stored as `"Male"` / `"Female"` in the database
(not `"M"` / `"F"`), so manually constructed URLs must use the full word.
