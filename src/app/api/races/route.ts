import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { RaceListItem } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 3600

export async function GET() {
  const races = await prisma.race.findMany({
    orderBy: { date: 'desc' },
    include: {
      _count: {
        select: { athletes: true },
      },
      athletes: {
        select: {
          result: {
            select: { dns: true, dnf: true, dsq: true },
          },
        },
      },
    },
  })

  const raceList: RaceListItem[] = races.map((race) => {
    const finisherCount = race.athletes.filter(
      (a) => a.result && !a.result.dns && !a.result.dnf && !a.result.dsq
    ).length

    return {
      id: race.id,
      slug: race.slug,
      name: race.name,
      location: race.location,
      date: race.date.toISOString().split('T')[0],
      distance: race.distance,
      passingMode: race.passingMode,
      legs: (race.legs as string[]) ?? [],
      athleteCount: race._count.athletes,
      finisherCount,
    }
  })

  return NextResponse.json(
    { races: raceList },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  )
}
