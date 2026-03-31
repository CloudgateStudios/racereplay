import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchRtrtRace } from '@/lib/rtrt-fetcher'
import { computePassingData } from '@/lib/passing-calc'
import type { RawResult } from '@/types/index'

export const maxDuration = 300

/**
 * Maps RTRT timing point names to leg names.
 * ORDER matters — this defines the legs array stored on the Race.
 */
const RTRT_POINT_TO_LEG: Record<string, string> = {
  SWIM: 'Swim',
  T1: 'T1',
  BIKE: 'Bike',
  T2: 'T2',
  FINISH: 'Run',
}

/**
 * POST /api/admin/import
 *
 * Full RTRT import pipeline:
 * 1. Fetch RTRT data for all timing points
 * 2. Optionally fetch competitor.com chip times
 * 3. Merge by bib, compute waveOffset
 * 4. Upsert athletes + results in chunks of 500
 * 5. Compute splitRanks
 * 6. Run passing-calc
 * 7. Bulk update passingData
 * 8. Update race metadata
 *
 * Auth enforced by middleware.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const startTime = Date.now()

  let body: {
    raceId?: unknown
    rtrtEventId?: unknown
    competitorUrl?: unknown
    clearExisting?: unknown
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { raceId, rtrtEventId, competitorUrl, clearExisting } = body

  // Validate required fields
  if (!raceId || typeof raceId !== 'string') {
    return NextResponse.json({ error: 'raceId is required' }, { status: 400 })
  }
  if (!rtrtEventId || typeof rtrtEventId !== 'string') {
    return NextResponse.json({ error: 'rtrtEventId is required' }, { status: 400 })
  }

  // SSRF protection: validate competitorUrl if provided
  if (competitorUrl != null) {
    if (typeof competitorUrl !== 'string') {
      return NextResponse.json({ error: 'competitorUrl must be a string' }, { status: 400 })
    }
    if (!competitorUrl.startsWith('https://labs-v2.competitor.com/')) {
      return NextResponse.json(
        { error: 'competitorUrl must be a labs-v2.competitor.com URL' },
        { status: 400 }
      )
    }
  }

  // Verify race exists
  const race = await prisma.race.findUnique({ where: { id: raceId } })
  if (!race) {
    return NextResponse.json({ error: 'Race not found' }, { status: 404 })
  }

  // Clear existing data if requested
  if (clearExisting === 'CONFIRM_DELETE') {
    await prisma.athlete.deleteMany({ where: { raceId } })
  }

  // ── Step 1: Fetch RTRT data ─────────────────────────────────────────────────
  let rtrtData: Awaited<ReturnType<typeof fetchRtrtRace>>
  try {
    rtrtData = await fetchRtrtRace(rtrtEventId)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `RTRT fetch failed: ${msg}` }, { status: 502 })
  }

  // ── Step 2: Optionally fetch competitor.com ─────────────────────────────────
  // (competitor.com integration is optional; if provided we'd merge chip times)
  // For now, we use RTRT netTime values as our chip times.
  // A full competitor.com merge can be added in a future phase.

  // ── Step 3: Build RawResult[] and compute waveOffsets ──────────────────────

  // Find the minimum start epoch across all athletes (for waveOffset computation)
  const startEpochs: number[] = []
  for (const record of rtrtData.values()) {
    if (record.startEpoch != null) startEpochs.push(record.startEpoch)
  }
  const minStartEpoch = startEpochs.length > 0 ? Math.min(...startEpochs) : null
  const hasWaveData = minStartEpoch != null

  // Determine legs from which RTRT timing points have data
  // Use the canonical order: SWIM, T1, BIKE, T2, FINISH → ['Swim', 'T1', 'Bike', 'T2', 'Run']
  const pointsWithData = (['SWIM', 'T1', 'BIKE', 'T2', 'FINISH'] as const).filter((point) => {
    let count = 0
    for (const record of rtrtData.values()) {
      if (record.netTimeSecs[point] != null) { count++; break }
    }
    return count > 0
  })

  const legs = pointsWithData.map((p) => RTRT_POINT_TO_LEG[p])

  // Build RawResult array
  const rawResults: RawResult[] = []

  for (const [bib, record] of rtrtData.entries()) {
    // Compute waveOffset
    let waveOffset: number | undefined
    if (hasWaveData && record.startEpoch != null && minStartEpoch != null) {
      waveOffset = Math.round(record.startEpoch - minStartEpoch)
    }

    // Build splits from netTime values (leg secs = cumulative difference)
    const splits: Record<string, number> = {}
    let prevCumSecs = 0

    for (const point of pointsWithData) {
      const legName = RTRT_POINT_TO_LEG[point]
      const cumSecs = record.netTimeSecs[point]
      if (cumSecs == null) break  // DNF at this leg
      const legSecs = Math.max(0, Math.round(cumSecs - prevCumSecs))
      splits[legName] = legSecs
      prevCumSecs = cumSecs
    }

    // Finish time is the cumulative chip time at FINISH point
    const finishCumSecs = record.netTimeSecs['FINISH']

    // Status: DNS if no start epoch AND no splits, DNF if splits incomplete, FIN otherwise
    let status: RawResult['status']
    if (Object.keys(splits).length === 0 && !record.startEpoch) {
      status = 'DNS'
    } else if (Object.keys(splits).length < legs.length) {
      status = 'DNF'
    } else {
      status = 'FIN'
    }

    // Normalize gender
    let gender: string | undefined
    if (record.sex === 'M' || record.sex === 'F') {
      gender = record.sex
    }

    rawResults.push({
      bib,
      fullName: record.name,
      gender,
      country: record.country,
      division: record.division,
      status,
      finishSecs: finishCumSecs != null ? Math.round(finishCumSecs) : undefined,
      waveOffset,
      overallRank: record.overallRank,
      genderRank: record.genderRank,
      divisionRank: record.divisionRank,
      splits,
    })
  }

  // ── Step 4: Upsert athletes + results in chunks of 500 ─────────────────────
  const CHUNK_SIZE = 500
  const upsertedAthleteIds = new Map<string, string>() // bib → athleteId

  for (let i = 0; i < rawResults.length; i += CHUNK_SIZE) {
    const chunk = rawResults.slice(i, i + CHUNK_SIZE)

    for (const raw of chunk) {
      // Normalize gender to Prisma enum values
      const genderVal: 'M' | 'F' | 'X' =
        raw.gender === 'M' ? 'M' : raw.gender === 'F' ? 'F' : 'X'

      const athlete = await prisma.athlete.upsert({
        where: { raceId_bib: { raceId, bib: raw.bib } },
        update: {
          fullName: raw.fullName,
          country: raw.country ?? null,
          division: raw.division ?? '',
          gender: genderVal,
        },
        create: {
          raceId,
          bib: raw.bib,
          fullName: raw.fullName,
          country: raw.country ?? null,
          division: raw.division ?? '',
          gender: genderVal,
        },
      })

      upsertedAthleteIds.set(raw.bib, athlete.id)

      await prisma.result.upsert({
        where: { athleteId: athlete.id },
        update: {
          raceId,
          splits: Object.keys(raw.splits).length > 0 ? raw.splits : undefined,
          finishSecs: raw.finishSecs ?? null,
          dns: raw.status === 'DNS',
          dnf: raw.status === 'DNF',
          dsq: raw.status === 'DSQ',
          waveOffset: raw.waveOffset ?? null,
          overallRank: raw.overallRank ?? null,
          genderRank: raw.genderRank ?? null,
          divisionRank: raw.divisionRank ?? null,
        },
        create: {
          athleteId: athlete.id,
          raceId,
          splits: Object.keys(raw.splits).length > 0 ? raw.splits : undefined,
          finishSecs: raw.finishSecs ?? null,
          dns: raw.status === 'DNS',
          dnf: raw.status === 'DNF',
          dsq: raw.status === 'DSQ',
          waveOffset: raw.waveOffset ?? null,
          overallRank: raw.overallRank ?? null,
          genderRank: raw.genderRank ?? null,
          divisionRank: raw.divisionRank ?? null,
        },
      })
    }
  }

  // ── Step 5: Compute splitRanks ─────────────────────────────────────────────
  // For each leg (excluding the final), rank athletes by cumulative chip time
  if (legs.length > 1) {
    const finishers = rawResults.filter((r) => r.status === 'FIN' && r.finishSecs != null)

    for (let legIdx = 0; legIdx < legs.length - 1; legIdx++) {
      const legsUpTo = legs.slice(0, legIdx + 1)
      const legName = legs[legIdx]

      // Compute cumulative time at this leg for each athlete
      const athleteCumTimes: Array<{ bib: string; cumSecs: number }> = []
      for (const r of finishers) {
        let cum = 0
        let valid = true
        for (const l of legsUpTo) {
          if (r.splits[l] == null) { valid = false; break }
          cum += r.splits[l]
        }
        if (valid) athleteCumTimes.push({ bib: r.bib, cumSecs: cum })
      }

      // Sort ascending by cumulative time
      athleteCumTimes.sort((a, b) => a.cumSecs - b.cumSecs)

      // Update splitRanks for each athlete
      for (let rank = 0; rank < athleteCumTimes.length; rank++) {
        const { bib } = athleteCumTimes[rank]
        const athleteId = upsertedAthleteIds.get(bib)
        if (!athleteId) continue

        // Use raw SQL to merge into existing JSON, or do a read-modify-write
        const existing = await prisma.result.findUnique({
          where: { athleteId },
          select: { splitRanks: true },
        })

        const currentRanks = (existing?.splitRanks as Record<string, number>) ?? {}
        currentRanks[legName] = rank + 1

        await prisma.result.update({
          where: { athleteId },
          data: { splitRanks: currentRanks },
        })
      }
    }
  }

  // ── Step 6: Run passing-calc ───────────────────────────────────────────────
  const passingMap = computePassingData(rawResults, legs, hasWaveData)

  // ── Step 7: Bulk update passingData ───────────────────────────────────────
  for (const [bib, passingData] of passingMap.entries()) {
    const athleteId = upsertedAthleteIds.get(bib)
    if (!athleteId) continue

    await prisma.result.update({
      where: { athleteId },
      data: { passingData: passingData as object },
    })
  }

  // ── Step 8: Run invariant check ───────────────────────────────────────────
  const invariantCheck: Record<string, boolean> = {}
  for (const leg of legs) {
    let totalGained = 0
    let totalLost = 0
    for (const data of passingMap.values()) {
      totalGained += data.legs[leg]?.gained ?? 0
      totalLost += data.legs[leg]?.lost ?? 0
    }
    invariantCheck[leg] = totalGained === totalLost
  }

  // ── Step 9: Update race metadata ──────────────────────────────────────────
  await prisma.race.update({
    where: { id: raceId },
    data: {
      passingMode: hasWaveData ? 'PHYSICAL' : 'CHIP_ONLY',
      legs: legs,
      rtrtEventId: rtrtEventId,
    },
  })

  // ── Summary stats ─────────────────────────────────────────────────────────
  const finishers = rawResults.filter((r) => r.status === 'FIN').length
  const dnfCount = rawResults.filter((r) => r.status === 'DNF').length
  const dnsCount = rawResults.filter((r) => r.status === 'DNS').length
  const rtrtStartsMatched = startEpochs.length

  return NextResponse.json({
    athletesImported: rawResults.length,
    finishers,
    dnfCount,
    dnsCount,
    rtrtStartsMatched,
    passingMode: hasWaveData ? 'PHYSICAL' : 'CHIP_ONLY',
    invariantCheck,
    durationMs: Date.now() - startTime,
  })
}
