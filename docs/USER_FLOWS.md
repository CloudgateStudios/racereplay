# RaceReplay — User Flows

**Version:** 1.0
**Last Updated:** 2026-03-30

---

## Overview

Two distinct user types interact with RaceReplay:

- **Public users** — athletes, coaches, and fans searching for race results and passing analysis. No account required.
- **Admin users** — a single operator who imports race data. Protected by session-based login.

---

## Public User Flows

### Flow 1 — Find an athlete in a race (primary)

The core journey for the majority of visitors.

```
/ (Home)
  → /[raceSlug] (Race page)
    → /[raceSlug]/athletes/[id] (Athlete analysis)
```

**Step 1 — Home page (`/`)**
- Lands on a list of race cards, ordered by date descending
- Each card shows: race name, date, location, finisher count, passing mode badge (Physical / Chip-only)
- Clicks a race card to continue

**Step 2 — Race page (`/[raceSlug]`)**
- Sees race metadata (name, date, location, distance, passing mode)
- Search box is immediately focused — searches by athlete name or bib number
- Results appear as the user types (300ms debounce); each result shows: name, bib, division, finish time, overall rank
- Clicks an athlete row to continue

**Step 3 — Athlete analysis page (`/[raceSlug]/athletes/[id]`)**
- Header: athlete name, bib, division, country
- Summary strip: overall finish rank, net positions gained/lost across the full race, start time offset (physical mode only — e.g. "Started +8m 12s after first wave")
- One card per leg in race order (Swim, T1, Bike, T2, Run):
  - Leg name, split time, rank at end of that leg
  - Positions gained and lost badges
  - Expandable "Passed" list: athletes X overtook during this leg (bib, name, division)
  - Expandable "Passed by" list: athletes who overtook X during this leg
  - Lists collapse to 10 entries with a "Show all N" toggle if longer
- User navigates away via browser back button — no explicit breadcrumb needed

---

### Flow 2 — Direct link to athlete page

A user arrives via a shared URL directly at `/[raceSlug]/athletes/[id]`.

- Full analysis renders immediately — no search step
- Race name in the header is a link back to the race page if the user wants to search for someone else
- Otherwise identical to Step 3 above

---

### Flow 3 — DNF athlete

Same as Flow 1, but the athlete did not finish.

- Analysis cards are shown only for legs the athlete completed
- A subtle notice appears below the summary strip: e.g. *"Did not finish — withdrew after Bike"*
- Legs after the dropout point are absent with no placeholder — the page simply ends at the last completed leg
- The notice is informational only, not a prominent warning

---

## Admin User Flows

### Flow 1 — Login

**Entry point:** Any `/admin/*` URL (or navigating directly to `/admin`)

1. Middleware detects no valid session cookie → redirects to `/admin/login`
2. Login page shows a single password field and a submit button
3. Admin enters the `ADMIN_SECRET` value and submits
4. **On success:** session cookie set (4-hour expiry), redirected to `/admin`
5. **On failure:** error message displayed inline — *"Incorrect password"*. Form stays on the page.
6. **After 5 failed attempts from the same IP:** rate limit message displayed — *"Too many attempts. Try again in a minute."* Form is disabled until the window resets.

---

### Flow 2 — Import a new race (primary admin task)

**Entry point:** `/admin` after login

**Step 1 — Admin dashboard (`/admin`)**
- Table of all existing races with columns: Name, Date, Distance, Athletes, Passing Mode, Last Imported, Actions
- "New Race" button in the top right

**Step 2 — Create race (`/admin/races/new`)**
- Form fields: Race name, Slug (auto-generated from name, editable), Date, Location, Distance (Full / 70.3)
- Submit → race record created → redirected to the import page for that race

**Step 3 — Import page (`/admin/races/[id]/import`)**
- Race name and metadata shown at the top for confirmation
- **RTRT import form** (primary):
  - RTRT Event ID input (e.g. `IRM-OCEANSIDE703-2026`) with a helper link to `track.rtrt.me`
  - Optional competitor.com URL input
  - Import button
- **CSV upload** (secondary, collapsible section):
  - File picker (CSV only)
  - "Has wave offset data" toggle
  - Upload button

**Step 4 — Import in progress**
- On submit, the form is replaced by a loading state
- A spinner with a status message: *"Fetching race data from RTRT.me — this takes around 5 minutes for a large race"*
- The request blocks until complete — no polling, no background job
- The page stays open; navigating away would cancel the import (browser will warn if the user tries to close the tab during a pending request)

**Step 5 — Import results**
- Summary shown on success:
  - Athletes imported, finishers, DNF count, DNS count
  - Passing mode used (Physical or Chip-only)
  - Invariant check: pass/fail per leg (sum of gained = sum of lost)
  - Duration
- *"View race"* link opens the public race page in a new tab for spot-checking
- *"Import again"* link returns to the import form if a re-run is needed
- On failure (RTRT fetch error, validation error): error message shown with the reason; form is restored so the admin can correct and retry

---

### Flow 3 — Re-import an existing race

**Entry point:** `/admin` → Actions → "Import" on an existing race row

- Lands on the same import page (`/admin/races/[id]/import`)
- RTRT Event ID field is pre-populated with the stored value from the previous import
- A "Clear existing data" toggle is shown (off by default). When toggled on, a confirmation text field appears requiring the admin to type `CONFIRM_DELETE` before the Import button becomes active — prevents accidental data wipes
- Import proceeds identically to Flow 2, Steps 4–5

---

### Flow 4 — Logout

- A logout button is visible in the admin navigation on all `/admin/*` pages
- Clicking it calls `POST /api/admin/logout`, which deletes the session token and clears the cookie
- Admin is redirected to `/admin/login`
- Any other browser tab or device that had the same session is now also invalidated — the next request from those tabs will redirect to login

---

## Page Inventory

| Page | Route | Type | User |
|---|---|---|---|
| Home — race list | `/` | Public | Public |
| Race page — athlete search | `/[raceSlug]` | Public | Public |
| Athlete analysis | `/[raceSlug]/athletes/[id]` | Public | Public |
| Admin login | `/admin/login` | Auth | Admin |
| Admin dashboard | `/admin` | Protected | Admin |
| Create race | `/admin/races/new` | Protected | Admin |
| Import / upload | `/admin/races/[id]/import` | Protected | Admin |
