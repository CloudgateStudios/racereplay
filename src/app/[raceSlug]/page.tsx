import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { Badge } from '@/components/ui/badge'
import { AthleteSearch } from '@/components/AthleteSearch'

export const revalidate = 3600

interface RacePageProps {
  params: Promise<{ raceSlug: string }>
}

export async function generateMetadata({ params }: RacePageProps): Promise<Metadata> {
  const { raceSlug } = await params

  const race = await prisma.race.findUnique({
    where: { slug: raceSlug },
    select: { name: true },
  })

  if (!race) {
    return { title: 'Race not found' }
  }

  return {
    title: race.name,
    description: `Leg-by-leg passing analysis for ${race.name}`,
  }
}

export default async function RacePage({ params }: RacePageProps) {
  const { raceSlug } = await params

  const race = await prisma.race.findUnique({
    where: { slug: raceSlug },
  })

  if (!race) {
    notFound()
  }

  const distanceLabel = race.distance === 'FULL' ? 'Full Distance' : '70.3'
  const passingModeLabel =
    race.passingMode === 'PHYSICAL' ? 'Physical Passing' : 'Chip-only'

  const formattedDate = race.date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })

  return (
    <main className="min-h-screen p-4 sm:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← All races
        </Link>
      </div>

      <div className="mb-8 space-y-2">
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">{race.name}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{distanceLabel}</Badge>
            <Badge
              className={
                race.passingMode === 'PHYSICAL'
                  ? 'bg-green-100 text-green-800 hover:bg-green-100'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-100'
              }
            >
              {passingModeLabel}
            </Badge>
          </div>
        </div>
        <p className="text-muted-foreground">{formattedDate}</p>
        <p className="text-muted-foreground">{race.location}</p>
      </div>

      <AthleteSearch raceSlug={raceSlug} />
    </main>
  )
}
