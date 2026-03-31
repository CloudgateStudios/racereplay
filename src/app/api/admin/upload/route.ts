import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseCSV } from '@/lib/csv-parser'
import { computePassingData } from '@/lib/passing-calc'
import type { RawResult } from '@/types/index'

export const maxDuration = 300

/**
 * POST /api/admin/upload
 *
 * CSV upload pipeline. Auth enforced by middleware.
 *
 * Accepts multipart/form-data with:
 * - raceId: string
 * - file: CSV file
 * - hasWaveData: "true" | "false"
 * - clearExisting: "CONFIRM_DELETE" to wipe existing data
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const startTime = Date.now()

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }

  const raceId = formData.get('raceId')
  const file = formData.get('file')
  const hasWaveDataStr = formData.get('hasWaveData')
  const clearExisting = formData.get('clearExisting')

  if (!raceId || typeof raceId !== 'string') {
    return NextResponse.json({ error: 'raceId is required' }, { status: 400 })
  }
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }

  const hasWaveData = hasWaveDataStr === 'true'

  // Verify race exists
  const race = await prisma.race.findUnique({ where: { id: raceId } })
  if (!race) {
    return NextResponse.json({ error: 'Race not found' }, { status: 404 })
  }

  // Clear existing data if requested
  if (clearExisting === 'CONFIRM_DELETE') {
    await prisma.athlete.deleteMany({ where: { raceId } })
  }

  // Parse CSV
  const fileBuffer = Buffer.from(await file.arrayBuffer())
  let legs: string[]
  let rawResults: RawResult[]

  try {
    const parsed = parseCSV(fileBuffer)
    legs = parsed.legs
    rawResults = parsed.results
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `CSV parse error: ${msg}` }, { status: 400 })
  }

  if (legs.length === 0) {
    return NextResponse.json(
      { error: 'No leg columns detected. CSV must have columns ending in "(Seconds)".' },
      { status: 400 }
    )
  }

  // ── Upsert athletes + results in chunks of 500 ─────────────────────────────
  const CHUNK_SIZE = 500
  const upsertedAthleteIds = new Map<string, string>()

  for (let i = 0; i < rawResults.length; i += CHUNK_SIZE) {
    const chunk = rawResults.slice(i, i + CHUNK_SIZE)

    for (const raw of chunk) {
      const genderVal: 'M' | 'F' | 'X' =
        raw.gender?.toUpperCase() === 'M' ? 'M'
        : raw.gender?.toUpperCase() === 'F' ? 'F'
        : 'X'

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
          waveOffset: hasWaveData ? (raw.waveOffset ?? null) : null,
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
          waveOffset: hasWaveData ? (raw.waveOffset ?? null) : null,
          overallRank: raw.overallRank ?? null,
          genderRank: raw.genderRank ?? null,
          divisionRank: raw.divisionRank ?? null,
        },
      })
    }
  }

  // ── Compute splitRanks ──────────────────────────────────────────────────────
  if (legs.length > 1) {
    const finishers = rawResults.filter((r) => r.status === 'FIN' && r.finishSecs != null)

    for (let legIdx = 0; legIdx < legs.length - 1; legIdx++) {
      const legsUpTo = legs.slice(0, legIdx + 1)
      const legName = legs[legIdx]

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

      athleteCumTimes.sort((a, b) => a.cumSecs - b.cumSecs)

      for (let rank = 0; rank < athleteCumTimes.length; rank++) {
        const { bib } = athleteCumTimes[rank]
        const athleteId = upsertedAthleteIds.get(bib)
        if (!athleteId) continue

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

  // ── Run passing-calc ────────────────────────────────────────────────────────
  const passingMap = computePassingData(rawResults, legs, hasWaveData)

  // ── Bulk update passingData ─────────────────────────────────────────────────
  for (const [bib, passingData] of passingMap.entries()) {
    const athleteId = upsertedAthleteIds.get(bib)
    if (!athleteId) continue

    await prisma.result.update({
      where: { athleteId },
      data: { passingData: passingData as object },
    })
  }

  // ── Invariant check ─────────────────────────────────────────────────────────
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

  // ── Update race metadata ────────────────────────────────────────────────────
  await prisma.race.update({
    where: { id: raceId },
    data: {
      passingMode: hasWaveData ? 'PHYSICAL' : 'CHIP_ONLY',
      legs,
    },
  })

  const finishers = rawResults.filter((r) => r.status === 'FIN').length
  const dnfCount = rawResults.filter((r) => r.status === 'DNF').length

  return NextResponse.json({
    athletesImported: rawResults.length,
    finishers,
    dnfCount,
    passingMode: hasWaveData ? 'PHYSICAL' : 'CHIP_ONLY',
    invariantCheck,
    durationMs: Date.now() - startTime,
  })
}
