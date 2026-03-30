# RaceReplay — API Specification

**Version:** 1.2
**Last Updated:** 2026-03-30

All routes are Next.js App Router API routes under `src/app/api/`. Base URL: `https://racereplay.app` (or `http://localhost:3000` in development).

---

## Authentication

Public routes require no authentication.

Admin routes require the header:
```
x-admin-secret: <value of ADMIN_SECRET env var>
```
Return `401 Unauthorized` if missing or incorrect.

---

## Public Routes

### GET /api/races

List all races, ordered by date descending.

**Response `200 OK`:**
```json
{
  "races": [
    {
      "id": "clx...",
      "slug": "oceanside703-2026",
      "name": "Athletic Brewing IRONMAN 70.3 Oceanside 2026",
      "location": "Oceanside, California",
      "date": "2026-03-28",
      "distance": "HALF",
      "passingMode": "PHYSICAL",
      "legs": ["Swim", "T1", "Bike", "T2", "Run"],
      "athleteCount": 3171,
      "finisherCount": 2973
    }
  ]
}
```

---

### GET /api/races/:slug

Get metadata for a single race.

**Path params:** `slug` — race slug (e.g. `oceanside703-2026`)

**Response `200 OK`:**
```json
{
  "race": {
    "id": "clx...",
    "slug": "oceanside703-2026",
    "name": "Athletic Brewing IRONMAN 70.3 Oceanside 2026",
    "location": "Oceanside, California",
    "date": "2026-03-28",
    "distance": "HALF",
    "passingMode": "PHYSICAL",
    "legs": ["Swim", "T1", "Bike", "T2", "Run"],
    "athleteCount": 3171,
    "finisherCount": 2973,
    "dnfCount": 198,
    "dnsCount": 0
  }
}
```

**Response `404 Not Found`:**
```json
{ "error": "Race not found" }
```

---

### GET /api/races/:slug/athletes

Search athletes within a race. Used by the debounced search box.

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `q` | string | `""` | Search by name or bib (case-insensitive, partial match) |
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Results per page (max 100) |

**Response `200 OK`:**
```json
{
  "athletes": [
    {
      "id": "clx...",
      "bib": "361",
      "fullName": "Tom Arra",
      "country": "US",
      "division": "M35-39",
      "gender": "M",
      "result": {
        "finishSecs": 16218,
        "overallRank": 751,
        "genderRank": 690,
        "divisionRank": 120,
        "dns": false,
        "dnf": false,
        "dsq": false
      }
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

---

### GET /api/races/:slug/athletes/:id

Get full result and passing analysis for one athlete.

**Path params:** `slug`, `id` (athlete cuid)

**Response `200 OK`:**
```json
{
  "athlete": {
    "id": "clx...",
    "bib": "361",
    "fullName": "Tom Arra",
    "country": "US",
    "division": "M35-39",
    "gender": "M"
  },
  "race": {
    "slug": "oceanside703-2026",
    "name": "Athletic Brewing IRONMAN 70.3 Oceanside 2026",
    "date": "2026-03-28",
    "distance": "HALF",
    "passingMode": "PHYSICAL",
    "legs": ["Swim", "T1", "Bike", "T2", "Run"]
  },
  "result": {
    "splits": {
      "Swim": 1842,
      "T1": 210,
      "Bike": 8340,
      "T2": 180,
      "Run": 5646
    },
    "splitRanks": {
      "Swim": 820,
      "T1": 800,
      "Bike": 760,
      "T2": 755
    },
    "finishSecs": 16218,
    "waveOffset": 611.2,
    "dns": false,
    "dnf": false,
    "dsq": false,
    "overallRank": 751,
    "genderRank": 690,
    "divisionRank": 120
  },
  "passing": {
    "Swim": {
      "gained": 39,
      "lost": 2,
      "passedAthletes": [ ... ],
      "passedByAthletes": [ ... ]
    },
    "T1": {
      "gained": 4,
      "lost": 0,
      "passedAthletes": [
        { "bib": "882", "fullName": "Alice Chen", "division": "F30-34" }
      ],
      "passedByAthletes": []
    },
    "Bike": {
      "gained": 37,
      "lost": 8,
      "passedAthletes": [ ... ],
      "passedByAthletes": [ ... ]
    },
    "T2": {
      "gained": 0,
      "lost": 1,
      "passedAthletes": [],
      "passedByAthletes": [ ... ]
    },
    "Run": {
      "gained": 8,
      "lost": 12,
      "passedAthletes": [ ... ],
      "passedByAthletes": [ ... ]
    },
    "overall": {
      "finishRank": 751,
      "netGained": 66
    }
  }
}
```

**Notes:**
- `race.legs` is an ordered array of leg names. The UI iterates this to render leg cards in the correct order — it never hardcodes `["Swim", "T1", "Bike", "T2", "Run"]` or any other fixed list.
- `result.splits` keys match `race.legs`. For a DNF athlete, legs after the point they dropped are absent from the object.
- `result.splitRanks` keys match `race.legs` excluding the final leg (whose rank equals `overallRank`).
- `waveOffset` is the athlete's start time in seconds after the earliest starter in the race. Present when `race.passingMode = "PHYSICAL"`, null otherwise.
- The stored `PassingData` JSONB uses `passedBibs`/`passedByBibs` (arrays of bib strings). The API route resolves these to full athlete objects via a single `WHERE bib IN (...) AND raceId = ?` query and renames them to `passedAthletes`/`passedByAthletes`. This resolution happens in the route handler, not the client.
- `passing` keys match `race.legs`. The object is `null` for DNS athletes.

**Response `404 Not Found`:**
```json
{ "error": "Athlete not found" }
```

---

## Admin Routes

All admin routes require the `x-admin-secret` header.

---

### POST /api/admin/races

Create a new race record (without importing results yet). Used to pre-register a race before the import runs.

**Request body:**
```json
{
  "slug": "oceanside703-2026",
  "name": "Athletic Brewing IRONMAN 70.3 Oceanside 2026",
  "location": "Oceanside, California",
  "date": "2026-03-28",
  "distance": "HALF"
}
```

**Validation:**
- `slug` must match `^[a-z0-9-]+$` and be unique
- `date` must be a valid ISO date string
- `distance` must be `"FULL"` or `"HALF"`

**Response `201 Created`:**
```json
{
  "race": {
    "id": "clx...",
    "slug": "oceanside703-2026",
    "name": "Athletic Brewing IRONMAN 70.3 Oceanside 2026",
    "location": "Oceanside, California",
    "date": "2026-03-28",
    "distance": "HALF",
    "passingMode": "CHIP_ONLY",
    "createdAt": "2026-03-29T12:00:00.000Z"
  }
}
```

**Response `409 Conflict`** if slug already exists.

---

### POST /api/admin/import

Import a race from RTRT.me (and optionally competitor.com). This is the primary import route — it fetches data, merges sources, computes passing stats, and persists everything.

**Request body (JSON):**

| Field | Type | Required | Description |
|---|---|---|---|
| `raceId` | string | Yes | cuid of the target race (must already exist) |
| `rtrtEventId` | string | Yes | RTRT.me event ID (e.g. `IRM-OCEANSIDE703-2026`) |
| `competitorUrl` | string | No | competitor.com event group URL for richer profile data (if published) |
| `clearExisting` | boolean | No | Delete existing athletes/results before import (default: `false`) |

**Example:**
```json
{
  "raceId": "clx...",
  "rtrtEventId": "IRM-OCEANSIDE703-2026",
  "competitorUrl": "https://labs-v2.competitor.com/results/event/4798aa20-f278-e111-b16a-005056956277"
}
```

**Processing steps (in order):**

1. Fetch RTRT.me splits at START, SWIM, T1, BIKE, T2, FINISH (server-side, paginated, rate-limited — ~5 min for 3000-athlete race)
2. If `competitorUrl` provided, fetch competitor.com chip times
3. Merge records by bib — competitor.com split times take precedence over RTRT `netTime` values when both are present
4. Compute `waveOffset` per athlete = `startEpoch - min(allStartEpochs)` (from RTRT START splits)
5. Update `race.passingMode = PHYSICAL` (or `CHIP_ONLY` if RTRT start data missing)
6. Update `race.rtrtEventId`
7. Upsert athletes (by bib + raceId)
8. Upsert results with `waveOffset`, split seconds, status
9. Compute `afterSwimRank`, `afterT1Rank`, `afterBikeRank`, `afterT2Rank`
10. Run passing-calc algorithm with `hasWaveData = true`
11. Bulk update `result.passingData`

**Response `200 OK`:**
```json
{
  "athletesImported": 3171,
  "finishers": 2973,
  "dnfCount": 198,
  "dnsCount": 0,
  "rtrtStartsMatched": 3170,
  "passingMode": "PHYSICAL",
  "invariantCheck": {
    "swim": true,
    "t1": true,
    "bike": true,
    "t2": true,
    "run": true
  },
  "durationMs": 312840
}
```

**Response `400 Bad Request`:**
```json
{ "error": "rtrtEventId is required" }
```

**Response `404 Not Found`** if `raceId` does not exist.

**Response `502 Bad Gateway`** if RTRT.me fetch fails after retries:
```json
{ "error": "RTRT fetch failed: No splits found at SWIM after 3 retries" }
```

---

### POST /api/admin/upload (legacy CSV upload)

Upload a pre-built CSV file directly. Use this when you have a CSV from the POC scripts (`scripts/fetch-rtrt-race.mjs` or `scripts/fetch-race.mjs`) and want to import it without re-fetching from external APIs.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `raceId` | string | Yes | cuid of the target race |
| `file` | File | Yes | CSV file (columns described below) |
| `hasWaveData` | boolean | No | Set `true` if CSV has `Wave Offset (Seconds)` column — enables physical passing mode (default: `false`) |
| `clearExisting` | boolean | No | Clear existing data before import (default: `false`) |

**CSV column format (case-insensitive, flexible order):**

| Column name variants | Required | Description |
|---|---|---|
| `Bib Number`, `Bib`, `BibNumber` | Yes | Bib number |
| `Athlete Name`, `Name`, `Athlete` | Yes | Full name |
| `Gender`, `Sex` | No | M/F (inferred from division if absent) |
| `Country`, `Nationality` | No | Country code |
| `Division`, `Div`, `Age Group` | No | Age group string |
| `Status` | No | `FIN`, `DNF`, `DNS`, `DSQ` |
| `Finish Time`, `Finish` | Yes | Total finish time `HH:MM:SS` |
| `Overall Rank`, `Pos`, `Position` | No | Overall finish position |
| `Gender Rank` | No | Gender rank |
| `Division Rank` | No | Division rank |
| `Wave Offset (Seconds)` | No | Seconds after earliest starter (from RTRT start data) |
| `Finish (Seconds)` | No | Pre-computed finish seconds |
| `<LegName> (Seconds)` | No | Pre-computed seconds for any leg (e.g. `Swim (Seconds)`, `5K (Seconds)`) |

**Leg detection:** any column ending in `(Seconds)` except `Finish (Seconds)`,
`Finish Gun (Seconds)`, and `Wave Offset (Seconds)` is treated as a race leg, in
column order. This drives both `race.legs` and the keys in `result.splits`. There is
no fixed list of leg names — the same parser handles triathlon CSVs (5 legs) and
road race CSVs (2 legs) without modification.

DNF/DNS/DSQ athletes have `--` or empty strings in time fields; those legs are
omitted from `result.splits` rather than stored as null.

**Processing steps:**
1. Parse CSV → `RawResult[]`
2. Validate required columns present
3. Convert time strings → seconds (or use pre-computed seconds columns)
4. Upsert athletes + results
5. Compute `afterXRank` fields
6. Run passing-calc → `Map<bib, PassingData>`
7. Bulk update `result.passingData`

**Response `200 OK`:**
```json
{
  "athletesImported": 3171,
  "finishers": 2973,
  "dnfCount": 198,
  "passingMode": "PHYSICAL",
  "durationMs": 8234
}
```

---

## Error Format

All error responses follow this shape:
```json
{
  "error": "Human-readable message"
}
```

---

## Pagination

Routes that return lists use offset pagination:
```
?page=1&limit=20
```
Response includes `total`, `page`, `limit`. Max limit is 100.
