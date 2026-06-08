# Race Replay — Feature Enhancements

Improvements to existing functionality. These build on what's already there
without requiring new pages or major architecture changes.

---

## 3. Manual dark mode toggle 🚧 In progress

**Branch:** `feat/dark-mode-toggle`

- `@custom-variant dark` changed from media-query to `.dark` class selector.
- Dark CSS variables moved from `@media (prefers-color-scheme: dark) { :root }` to `.dark { }`.
- New `ThemeToggle` client component — sun/moon icon, lazy `useState` initializer to read DOM class without a `useEffect` round-trip.
- No-FOUC `<Script strategy="beforeInteractive">` in `layout.tsx` applies `.dark` before first paint, respecting `localStorage` with system-pref fallback.
- Toggle button added to header nav.
- System preference takes priority until the user manually flips the toggle; a `matchMedia` listener keeps the page in sync with OS changes while no manual override is stored.

**Files:** `app/src/app/globals.css`, `app/src/app/layout.tsx`, `app/src/components/theme-toggle.tsx`.

---

## 4. Athlete funnel visualization improvements ⚠️ Partially complete

**What's done:** Percentage labels next to each segment count were added in PR #58.

**Still to do:**

- Visually highlight the segment with the highest DNF/dropout rate.
- Consider a simple bar or step chart for events with large fields.

**Files:** `app/src/app/events/[slug]/[year]/funnel.tsx`
