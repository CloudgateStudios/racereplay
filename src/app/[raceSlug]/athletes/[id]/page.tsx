import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { PassingAnalysis } from '@/components/PassingAnalysis'
import { formatTime } from '@/lib/time-utils'
import type { AthleteAnalysisResponse, PassingData, LegPassingStats } from '@/types'

export const revalidate = 3600

interface AthletePageProps {
  params: Promise<{ raceSlug: string; id: string }>
}

export default async function AthletePage({ params }: AthletePageProps) {
  const { raceSlug, id } = await params

  const [race, athlete] = await Promise.all([
    prisma.race.findUnique({ where: { slug: raceSlug } }),
    prisma.athlete.findUnique({
      where: { id },
      include: { result: true },
    }),
  ])

  if (!race || !athlete || athlete.raceId !== race.id) {
    notFound()
  }

  const result = athlete.result
  const passingData = result?.passingData as PassingData | null

  // Resolve bibs → athlete objects
  let passing: AthleteAnalysisResponse['passing'] = null

  if (passingData && result) {
    const allBibs = new Set<string>()
    for (const legStats of Object.values(passingData.legs)) {
      const stats = legStats as LegPassingStats
      stats.passedBibs?.forEach((b) => allBibs.add(b))
      stats.passedByBibs?.forEach((b) => allBibs.add(b))
    }

    const resolvedAthletes = await prisma.athlete.findMany({
      where: {
        raceId: race.id,
        bib: { in: Array.from(allBibs) },
      },
      select: { bib: true, fullName: true, division: true },
    })

    const bibMap = new Map(resolvedAthletes.map((a) => [a.bib, a]))

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

  const analysisData: AthleteAnalysisResponse = {
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

  // Determine last completed leg for DNF notice
  const legs = analysisData.race.legs
  const splits = analysisData.result.splits
  let lastCompletedLeg: string | null = null
  if (analysisData.result.dnf) {
    for (let i = legs.length - 1; i >= 0; i--) {
      if (splits[legs[i]] != null) {
        lastCompletedLeg = legs[i]
        break
      }
    }
  }

  // Wave offset display
  const waveOffset = analysisData.result.waveOffset
  const waveOffsetDisplay =
    race.passingMode === 'PHYSICAL' && waveOffset != null && waveOffset > 0
      ? `Started +${formatTime(Math.round(waveOffset))} after first wave`
      : null

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      {/* Back link */}
      <div className="mb-6">
        <Link
          href={`/${raceSlug}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {race.name}
        </Link>
      </div>

      {/* Athlete header */}
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-bold">{athlete.fullName}</h1>
        <p className="text-muted-foreground">
          Bib #{athlete.bib} &middot; {athlete.division}
          {athlete.country ? ` \u00B7 ${athlete.country}` : ''}
        </p>
      </div>

      {/* Summary strip */}
      <div className="mb-4 flex flex-wrap gap-4 text-sm p-4 bg-muted rounded-lg">
        {analysisData.result.overallRank != null && (
          <span>
            Overall rank: <strong>#{analysisData.result.overallRank}</strong>
          </span>
        )}
        {passing?.overall != null && (
          <span>
            Net positions:{' '}
            <strong
              className={
                passing.overall.netGained > 0
                  ? 'text-green-700'
                  : passing.overall.netGained < 0
                    ? 'text-red-700'
                    : ''
              }
            >
              {passing.overall.netGained > 0
                ? `+${passing.overall.netGained}`
                : passing.overall.netGained}
            </strong>
          </span>
        )}
        {waveOffsetDisplay && <span>{waveOffsetDisplay}</span>}
      </div>

      {/* DNF notice */}
      {analysisData.result.dnf && (
        <p className="mb-4 text-sm text-muted-foreground italic">
          Did not finish
          {lastCompletedLeg ? ` — withdrew after ${lastCompletedLeg}` : ''}
        </p>
      )}

      {/* Passing analysis */}
      <PassingAnalysis data={analysisData} />
    </main>
  )
}
