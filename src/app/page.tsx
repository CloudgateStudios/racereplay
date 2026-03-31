import { prisma } from '@/lib/prisma'
import { RaceCard } from '@/components/RaceCard'
import type { RaceListItem } from '@/types'

export const revalidate = 3600

export default async function HomePage() {
  const races = await prisma.race.findMany({
    orderBy: { date: 'desc' },
    include: {
      athletes: {
        select: {
          result: {
            select: { dns: true, dnf: true, dsq: true },
          },
        },
      },
      _count: {
        select: { athletes: true },
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

  return (
    <main className="min-h-screen p-4 sm:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">RaceReplay</h1>
        <p className="text-muted-foreground mt-1">
          Leg-by-leg passing analysis for endurance races
        </p>
      </div>

      {raceList.length === 0 ? (
        <p className="text-muted-foreground">No races uploaded yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {raceList.map((race) => (
            <RaceCard key={race.id} race={race} />
          ))}
        </div>
      )}
    </main>
  )
}
