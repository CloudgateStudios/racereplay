# RaceTrace — API Specification

**Version:** 1.0
**Last Updated:** 2026-03-29

All routes are Next.js App Router API routes under `src/app/api/`. Base URL: `https://racetrace.app` (or `http://localhost:3000` in development).

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
      "slug": "kona-2024",
      "name": "IRONMAN World Championship 2024",
      "location": "Kailua-Kona, Hawaii",
      "date": "2024-10-26",
      "distance": "FULL",
      "athleteCount": 2531,
      "finisherCount": 2418
    }
  ]
}
```

---

### GET /api/races/:slug

Get metadata for a single race.

**Path params:** `slug` — race slug (e.g. `kona-2024`)

**Response `200 OK`:**
```json
{
  "race": {
    "id": "clx...",
    "slug": "kona-2024",
    "name": "IRONMAN World Championship 2024",
    "location": "Kailua-Kona, Hawaii",
    "date": "2024-10-26",
    "distance": "FULL",
    "athleteCount": 2531,
    "finisherCount": 2418,
    "dnfCount": 113,
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
      "bib": "1234",
      "fullName": "Jane Smith",
      "country": "USA",
      "division": "F35-39",
      "gender": "F",
      "result": {
        "finishSecs": 36842,
        "overallRank": 127,
        "genderRank": 14,
        "divisionRank": 3,
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
    "bib": "1234",
    "fullName": "Jane Smith",
    "country": "USA",
    "division": "F35-39",
    "gender": "F"
  },
  "race": {
    "slug": "kona-2024",
    "name": "IRONMAN World Championship 2024",
    "date": "2024-10-26",
    "distance": "FULL"
  },
  "result": {
    "swimSecs": 3842,
    "t1Secs": 412,
    "bikeSecs": 19800,
    "t2Secs": 305,
    "runSecs": 12483,
    "finishSecs": 36842,
    "dns": false,
    "dnf": false,
    "dsq": false,
    "overallRank": 127,
    "genderRank": 14,
    "divisionRank": 3,
    "afterSwimRank": 201,
    "afterT1Rank": 195,
    "afterBikeRank": 134,
    "afterT2Rank": 131
  },
  "passing": {
    "swim": {
      "gained": 0,
      "lost": 0,
      "passedAthletes": [],
      "passedByAthletes": []
    },
    "t1": {
      "gained": 6,
      "lost": 0,
      "passedAthletes": [
        { "bib": "882", "fullName": "Alice Chen", "division": "F30-34" },
        { "bib": "1105", "fullName": "Sarah Park", "division": "F35-39" }
      ],
      "passedByAthletes": []
    },
    "bike": {
      "gained": 61,
      "lost": 0,
      "passedAthletes": [ ... ],
      "passedByAthletes": []
    },
    "t2": {
      "gained": 3,
      "lost": 0,
      "passedAthletes": [ ... ],
      "passedByAthletes": []
    },
    "run": {
      "gained": 0,
      "lost": 4,
      "passedAthletes": [],
      "passedByAthletes": [
        { "bib": "990", "fullName": "Marie Dupont", "division": "F35-39" }
      ]
    },
    "overall": {
      "finishRank": 127,
      "netGained": 70
    }
  }
}
```

**Note:** The `passing.*.passedAthletes` and `passedByAthletes` arrays are resolved from bibs to full athlete objects by joining on the athletes table. This resolution happens in the API route, not in the client.

**Response `404 Not Found`:**
```json
{ "error": "Athlete not found" }
```

---

## Admin Routes

All admin routes require `x-admin-secret` header.

---

### POST /api/admin/races

Create a new race record (without importing results yet).

**Request body:**
```json
{
  "slug": "kona-2024",
  "name": "IRONMAN World Championship 2024",
  "location": "Kailua-Kona, Hawaii",
  "date": "2024-10-26",
  "distance": "FULL"
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
    "slug": "kona-2024",
    "name": "IRONMAN World Championship 2024",
    "location": "Kailua-Kona, Hawaii",
    "date": "2024-10-26",
    "distance": "FULL",
    "createdAt": "2026-03-29T12:00:00.000Z"
  }
}
```

**Response `409 Conflict`** if slug already exists.

---

### POST /api/admin/upload

Upload a CSV file of race results. Parses, imports, and pre-computes all passing data.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `raceId` | string | Yes | cuid of the target race (must already exist) |
| `file` | File | Yes | CSV file — see column format below |
| `clearExisting` | boolean | No | If `true`, delete existing athletes/results for this race before import (default: `false`) |

**CSV column format (case-insensitive, flexible order):**

| Column name variants | Required | Description |
|---|---|---|
| `Pos`, `Position`, `Overall` | No | Overall finish position |
| `Bib`, `BibNumber`, `Bib #` | Yes | Bib number |
| `Name`, `Athlete`, `Athlete Name` | Yes | Full name |
| `Country`, `Nationality` | No | Country code or name |
| `Division`, `Div`, `Age Group` | No | Age group string |
| `Gender`, `Sex` | No | M/F/X (inferred from division if absent) |
| `Swim`, `Swim Time` | Yes | Split time in `HH:MM:SS` |
| `T1`, `Trans1`, `Transition 1` | Yes | Transition 1 time |
| `Bike`, `Bike Time`, `Cycle` | Yes | Bike split time |
| `T2`, `Trans2`, `Transition 2` | Yes | Transition 2 time |
| `Run`, `Run Time` | Yes | Run split time |
| `Finish`, `Finish Time`, `Total` | Yes | Total finish time |
| `Points`, `AWA Points` | No | Qualification points (stored but not used) |

DNF/DNS/DSQ athletes should have `--` or empty strings in time fields.

**Processing steps (in order):**
1. Parse CSV → `RawResult[]`
2. Validate required columns present
3. Convert all time strings to seconds
4. Upsert athletes (by bib + raceId)
5. Upsert results
6. Compute `afterSwimRank`, `afterT1Rank`, `afterBikeRank`, `afterT2Rank`
7. Run passing-calc algorithm → `Map<athleteId, PassingData>`
8. Bulk update `result.passingData`

**Response `200 OK`:**
```json
{
  "athletesImported": 2531,
  "finishers": 2418,
  "dnfCount": 113,
  "dnsCount": 0,
  "durationMs": 8234
}
```

**Response `400 Bad Request`** with validation errors:
```json
{
  "error": "Missing required columns: Swim, T1",
  "missingColumns": ["Swim", "T1"]
}
```

**Response `404 Not Found`** if `raceId` does not exist.

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

Routes that return lists use cursor-free offset pagination:
```
?page=1&limit=20
```
Response includes `total`, `page`, `limit`. Max limit is 100.
