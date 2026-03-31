'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatTime, formatTimeMM } from '@/lib/time-utils'
import { PassedAthleteList } from '@/components/PassedAthleteList'

interface PassedAthlete {
  bib: string
  fullName: string
  division: string
}

interface LegCardProps {
  legName: string
  splitSecs?: number
  rank?: number
  gained: number
  lost: number
  passedAthletes: PassedAthlete[]
  passedByAthletes: PassedAthlete[]
}

export function LegCard({
  legName,
  splitSecs,
  rank,
  gained,
  lost,
  passedAthletes,
  passedByAthletes,
}: LegCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  const formattedTime =
    splitSecs != null
      ? splitSecs < 300
        ? formatTimeMM(splitSecs)
        : formatTime(splitSecs)
      : null

  const hasDetails = passedAthletes.length > 0 || passedByAthletes.length > 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">{legName}</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {formattedTime != null && (
              <span className="text-sm text-muted-foreground font-mono">
                {formattedTime}
              </span>
            )}
            {rank != null && (
              <span className="text-sm text-muted-foreground">Rank: #{rank}</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {gained > 0 && (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              +{gained} gained
            </Badge>
          )}
          {gained === 0 && (
            <Badge variant="outline" className="text-muted-foreground">
              +0 gained
            </Badge>
          )}
          {lost > 0 && (
            <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
              &minus;{lost} lost
            </Badge>
          )}
          {lost === 0 && (
            <Badge variant="outline" className="text-muted-foreground">
              &minus;0 lost
            </Badge>
          )}
          {hasDetails && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-0.5 px-2 text-xs ml-auto"
              onClick={() => setDetailsOpen((prev) => !prev)}
            >
              {detailsOpen ? 'Hide details' : 'Show details'}
            </Button>
          )}
        </div>

        {detailsOpen && (
          <div className="space-y-3 border-t pt-3">
            <PassedAthleteList athletes={passedAthletes} label="Passed" />
            <PassedAthleteList athletes={passedByAthletes} label="Passed by" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
