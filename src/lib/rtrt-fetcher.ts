/**
 * rtrt-fetcher.ts
 *
 * Server-side RTRT.me data fetcher for the admin import pipeline.
 * Ports the proven logic from scripts/fetch-rtrt-event.mjs to TypeScript.
 *
 * Usage: called exclusively from POST /api/admin/import — never from client code.
 *
 * Rate limits: 300ms between pages within a timing point, 5s between points.
 * Handles "no_results" pagination overflow gracefully (not an error).
 */

const RTRT_API = 'https://api.rtrt.me'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
const PAGE_SIZE = 20
const PAGE_DELAY_MS = 300    // ms between pages within a timing point
const POINT_DELAY_MS = 5000  // ms between timing points

// ─── Internal types ────────────────────────────────────────────────────────────

/** A single split record returned by RTRT for one athlete at one timing point */
type RtrtSplitRecord = {
  bib: string
  name: string
  epochTime?: string    // Unix epoch timestamp (string from API)
  netTime?: string      // Cumulative chip time e.g. "H:MM:SS"
  startTime?: string    // Local time of day at start
  sex?: string
  country?: string
  country_iso?: string
  division?: string
  results?: Record<string, { p?: number; t?: string }>
}

/** Internal record combining data across all timing points for one athlete */
export type RtrtAthleteRecord = {
  bib: string
  name: string
  sex?: string
  country?: string
  division?: string
  startEpoch?: number   // Unix epoch seconds at START point
  /** Net (chip) time in seconds at each timing point */
  netTimeSecs: Partial<Record<RtrtTimingPoint, number>>
  overallRank?: number
  genderRank?: number
  divisionRank?: number
}

/** The standard IRONMAN triathlon timing points */
export type RtrtTimingPoint = 'START' | 'SWIM' | 'T1' | 'BIKE' | 'T2' | 'FINISH'

const TIMING_POINTS: RtrtTimingPoint[] = ['START', 'SWIM', 'T1', 'BIKE', 'T2', 'FINISH']

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function rtrtFetch(path: string): Promise<unknown> {
  const res = await fetch(`${RTRT_API}${path}`, {
    headers: { 'User-Agent': UA },
  })
  if (!res.ok) {
    throw new Error(`RTRT API ${path} → HTTP ${res.status}`)
  }
  return res.json()
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function register(appId: string): Promise<string> {
  const data = (await rtrtFetch(`/register?appid=${appId}`)) as Record<string, unknown>
  if (!data.token || typeof data.token !== 'string') {
    throw new Error(`RTRT registration failed: ${JSON.stringify(data)}`)
  }
  return data.token
}

/** Parse "H:MM:SS" or "MM:SS" cumulative time string → integer seconds, or null */
function parseNetTime(t: string | undefined): number | null {
  if (!t) return null
  const parts = t.split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2])
  if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1])
  return null
}

/**
 * Fetch all splits at one timing point, paginating until end.
 * Handles "no_results" as end-of-data (not an error).
 * Retries up to 3 times on transient errors with token refresh.
 */
async function fetchAllSplitsAtPoint(
  eventId: string,
  point: RtrtTimingPoint,
  appId: string,
  tokenRef: { value: string }
): Promise<Map<string, RtrtSplitRecord>> {
  const map = new Map<string, RtrtSplitRecord>()
  let start = 1
  let retries = 0

  while (true) {
    const qs = `appid=${appId}&token=${tokenRef.value}`
    const url = `/events/${eventId}/points/${point}/splits?${qs}&start=${start}`
    const data = (await rtrtFetch(url)) as Record<string, unknown>

    // Check for API error
    if (data.error && typeof data.error === 'object') {
      const err = data.error as Record<string, unknown>
      const type = err.type as string | undefined
      const msg = (err.msg as string | undefined) ?? ''

      // "no_results" = paginated past the end — this is end-of-data, not a real error
      if (
        type === 'no_results' ||
        type === 'access_denied' ||
        msg.toLowerCase().includes('not found')
      ) {
        return map
      }

      // Transient error — back off and retry with a fresh token
      if (retries < 3) {
        retries++
        const waitMs = retries * 5000
        await delay(waitMs)
        tokenRef.value = await register(appId)
        continue
      }

      throw new Error(`RTRT splits fetch at ${point} failed after retries: ${msg}`)
    }

    retries = 0

    const list = data.list as RtrtSplitRecord[] | undefined
    if (!list || list.length === 0) break

    for (const s of list) {
      const bib = String(s.bib)
      if (!map.has(bib)) map.set(bib, s)
    }

    if (list.length < PAGE_SIZE) break

    const info = data.info as Record<string, unknown> | undefined
    const last = parseInt(String(info?.last ?? start), 10)
    start = last + 1

    await delay(PAGE_DELAY_MS)
  }

  return map
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch all RTRT data for an event across all 6 triathlon timing points.
 *
 * Returns Map<bib, RtrtAthleteRecord> with:
 * - startEpoch: Unix epoch seconds at START
 * - netTimeSecs: chip time in seconds at each timing point (SWIM, T1, BIKE, T2, FINISH)
 * - Profile data (name, sex, country, division, rankings)
 */
export async function fetchRtrtRace(eventId: string): Promise<Map<string, RtrtAthleteRecord>> {
  const appId = process.env.RTRT_APP_ID
  if (!appId) throw new Error('RTRT_APP_ID environment variable is not set')

  const tokenRef = { value: await register(appId) }

  // Fetch all timing points
  const splitsByPoint = new Map<RtrtTimingPoint, Map<string, RtrtSplitRecord>>()

  for (let i = 0; i < TIMING_POINTS.length; i++) {
    const point = TIMING_POINTS[i]

    if (i > 0) {
      await delay(POINT_DELAY_MS)
    }

    const splits = await fetchAllSplitsAtPoint(eventId, point, appId, tokenRef)
    splitsByPoint.set(point, splits)
  }

  // Build unified athlete records
  const startSplits = splitsByPoint.get('START') ?? new Map<string, RtrtSplitRecord>()
  const finishSplits = splitsByPoint.get('FINISH') ?? new Map<string, RtrtSplitRecord>()

  // Union of all bibs across all points
  const allBibs = new Set<string>()
  for (const [, splitMap] of splitsByPoint) {
    for (const bib of splitMap.keys()) allBibs.add(bib)
  }

  const result = new Map<string, RtrtAthleteRecord>()

  for (const bib of allBibs) {
    // Profile data: prefer FINISH record (more likely to have rankings), fall back to START
    const finishRecord = finishSplits.get(bib)
    const startRecord = startSplits.get(bib)
    const profile = finishRecord ?? startRecord

    if (!profile) continue

    const name = profile.name ?? bib
    const sex = profile.sex
    const country = (profile.country_iso?.toUpperCase()) ?? profile.country
    const division = profile.division

    // Start epoch from START point
    let startEpoch: number | undefined
    if (startRecord?.epochTime) {
      const parsed = parseFloat(startRecord.epochTime)
      if (!isNaN(parsed)) startEpoch = Math.floor(parsed)
    }

    // Rankings from FINISH record
    let overallRank: number | undefined
    let genderRank: number | undefined
    let divisionRank: number | undefined

    if (finishRecord?.results) {
      const r = finishRecord.results
      overallRank = r['course']?.p ?? r['overall']?.p
      genderRank = r['course-sex']?.p ?? r['gender']?.p
      divisionRank = r['course-sex-division']?.p ?? r['agegroup']?.p
    }

    // Net times at each point (excluding START which is just a timestamp)
    const netTimeSecs: Partial<Record<RtrtTimingPoint, number>> = {}
    for (const point of TIMING_POINTS) {
      if (point === 'START') continue
      const splitRecord = splitsByPoint.get(point)?.get(bib)
      if (splitRecord?.netTime) {
        const secs = parseNetTime(splitRecord.netTime)
        if (secs != null) netTimeSecs[point] = secs
      }
    }

    result.set(bib, {
      bib,
      name,
      sex,
      country,
      division,
      startEpoch,
      netTimeSecs,
      overallRank,
      genderRank,
      divisionRank,
    })
  }

  return result
}
