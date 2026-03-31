import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { RaceDetail } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 3600

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const race = await prisma.race.findUnique({
    where: { slug },
    include: {
      athletes: {
        select: {
          result: {
            select: { dns: true, dnf: true, dsq: true },
          },
        },
      },
    },
  })

  if (!race) {
    return NextResponse.json({ error: 'Race not found' }, { status: 404 })
  }

  const finisherCount = race.athletes.filter(
    (a) => a.result && !a.result.dns && !a.result.dnf && !a.result.dsq
  ).length
  const dnfCount = race.athletes.filter((a) => a.result?.dnf).length
  const dnsCount = race.athletes.filter((a) => a.result?.dns).length
  const athleteCount = race.athletes.length

  const raceDetail: RaceDetail = {
    id: race.id,
    slug: race.slug,
    name: race.name,
    location: race.location,
    date: race.date.toISOString().split('T')[0],
    distance: race.distance,
    passingMode: race.passingMode,
    legs: (race.legs as string[]) ?? [],
    athleteCount,
    finisherCount,
    dnfCount,
    dnsCount,
  }

  return NextResponse.json(
    { race: raceDetail },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  )
}
