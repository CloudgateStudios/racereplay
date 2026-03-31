import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { AthleteSearchResult } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 3600

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const { searchParams } = new URL(req.url)

  const q = searchParams.get('q') ?? ''
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const rawLimit = parseInt(searchParams.get('limit') ?? '20', 10)
  const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 20 : rawLimit))
  const skip = (page - 1) * limit

  const race = await prisma.race.findUnique({
    where: { slug },
    select: { id: true },
  })

  if (!race) {
    return NextResponse.json({ error: 'Race not found' }, { status: 404 })
  }

  const whereClause = q.trim()
    ? {
        raceId: race.id,
        OR: [
          { fullName: { contains: q, mode: 'insensitive' as const } },
          { bib: { startsWith: q, mode: 'insensitive' as const } },
        ],
      }
    : { raceId: race.id }

  const [athletes, total] = await Promise.all([
    prisma.athlete.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: [{ result: { overallRank: 'asc' } }, { fullName: 'asc' }],
      include: {
        result: {
          select: {
            finishSecs: true,
            overallRank: true,
            genderRank: true,
            divisionRank: true,
            dns: true,
            dnf: true,
            dsq: true,
          },
        },
      },
    }),
    prisma.athlete.count({ where: whereClause }),
  ])

  const results: AthleteSearchResult[] = athletes.map((a) => ({
    id: a.id,
    bib: a.bib,
    fullName: a.fullName,
    country: a.country ?? undefined,
    division: a.division,
    gender: a.gender,
    result: {
      finishSecs: a.result?.finishSecs ?? undefined,
      overallRank: a.result?.overallRank ?? undefined,
      genderRank: a.result?.genderRank ?? undefined,
      divisionRank: a.result?.divisionRank ?? undefined,
      dns: a.result?.dns ?? false,
      dnf: a.result?.dnf ?? false,
      dsq: a.result?.dsq ?? false,
    },
  }))

  return NextResponse.json(
    { athletes: results, total, page, limit },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  )
}
