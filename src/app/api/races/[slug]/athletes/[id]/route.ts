import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { AthleteAnalysisResponse, PassingData, LegPassingStats } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 3600

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params

  // Fetch race + athlete + result in parallel
  const [race, athlete] = await Promise.all([
    prisma.race.findUnique({ where: { slug } }),
    prisma.athlete.findUnique({
      where: { id },
      include: {
        result: true,
      },
    }),
  ])

  if (!race || !athlete || athlete.raceId !== race.id) {
    return NextResponse.json({ error: 'Athlete not found' }, { status: 404 })
  }

  const result = athlete.result

  // Collect all bibs referenced in passingData so we can resolve them in one query
  const passingData = result?.passingData as PassingData | null

  let passing: AthleteAnalysisResponse['passing'] = null

  if (passingData && result) {
    // Gather all unique bibs across all legs
    const allBibs = new Set<string>()
    for (const legStats of Object.values(passingData.legs)) {
      const stats = legStats as LegPassingStats
      stats.passedBibs?.forEach((b) => allBibs.add(b))
      stats.passedByBibs?.forEach((b) => allBibs.add(b))
    }

    // Single query to resolve all bibs
    const resolvedAthletes = await prisma.athlete.findMany({
      where: {
        raceId: race.id,
        bib: { in: Array.from(allBibs) },
      },
      select: { bib: true, fullName: true, division: true },
    })

    const bibMap = new Map(resolvedAthletes.map((a) => [a.bib, a]))

    // Build the passing response
    const passingLegs: Record<
      string,
      {
        gained: number
        lost: number
        passedAthletes: Array<{ bib: string; fullName: string; division: string }>
        passedByAthletes: Array<{ bib: string; fullName: string; division: string }>
      }
    > = {}

    for (const [legName, legStats] of Object.entries(passingData.legs)) {
      const stats = legStats as LegPassingStats
      passingLegs[legName] = {
        gained: stats.gained,
        lost: stats.lost,
        passedAthletes: (stats.passedBibs ?? []).map((bib) => {
          const a = bibMap.get(bib)
          return { bib, fullName: a?.fullName ?? bib, division: a?.division ?? '' }
        }),
        passedByAthletes: (stats.passedByBibs ?? []).map((bib) => {
          const a = bibMap.get(bib)
          return { bib, fullName: a?.fullName ?? bib, division: a?.division ?? '' }
        }),
      }
    }

    passing = {
      ...passingLegs,
      overall: passingData.overall,
    } as AthleteAnalysisResponse['passing']
  }

  const response: AthleteAnalysisResponse = {
    athlete: {
      id: athlete.id,
      bib: athlete.bib,
      fullName: athlete.fullName,
      country: athlete.country ?? undefined,
      division: athlete.division,
      gender: athlete.gender,
    },
    race: {
      slug: race.slug,
      name: race.name,
      date: race.date.toISOString().split('T')[0],
      distance: race.distance,
      passingMode: race.passingMode,
      legs: (race.legs as string[]) ?? [],
    },
    result: {
      splits: (result?.splits as Record<string, number>) ?? {},
      splitRanks: (result?.splitRanks as Record<string, number>) ?? {},
      finishSecs: result?.finishSecs ?? undefined,
      waveOffset: result?.waveOffset ?? undefined,
      dns: result?.dns ?? false,
      dnf: result?.dnf ?? false,
      dsq: result?.dsq ?? false,
      overallRank: result?.overallRank ?? undefined,
      genderRank: result?.genderRank ?? undefined,
      divisionRank: result?.divisionRank ?? undefined,
    },
    passing,
  }

  return NextResponse.json(response, {
    headers: {
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
