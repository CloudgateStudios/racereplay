import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { RaceListItem } from '@/types'

interface RaceCardProps {
  race: RaceListItem
}

export function RaceCard({ race }: RaceCardProps) {
  const distanceLabel = race.distance === 'FULL' ? 'Full Distance' : '70.3'
  const passingModeLabel =
    race.passingMode === 'PHYSICAL' ? 'Physical Passing' : 'Chip-only'
  const passingModeBadgeClass =
    race.passingMode === 'PHYSICAL'
      ? 'bg-green-100 text-green-800 hover:bg-green-100'
      : 'bg-gray-100 text-gray-700 hover:bg-gray-100'

  return (
    <Link href={`/${race.slug}`} className="block group">
      <Card className="transition-shadow group-hover:shadow-md cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-lg leading-tight group-hover:text-blue-600 transition-colors">
              {race.name}
            </CardTitle>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge variant="outline">{distanceLabel}</Badge>
              <Badge className={passingModeBadgeClass}>{passingModeLabel}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>
            {new Date(race.date + 'T00:00:00').toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <p>{race.location}</p>
          <p className="text-foreground font-medium">
            {race.finisherCount.toLocaleString()} finishers
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}
