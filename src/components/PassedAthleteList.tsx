'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface PassedAthlete {
  bib: string
  fullName: string
  division: string
}

interface PassedAthleteListProps {
  athletes: PassedAthlete[]
  label: string
}

const COLLAPSED_LIMIT = 10

export function PassedAthleteList({ athletes, label }: PassedAthleteListProps) {
  const [expanded, setExpanded] = useState(false)

  if (athletes.length === 0) return null

  const visible = expanded ? athletes : athletes.slice(0, COLLAPSED_LIMIT)
  const hasMore = athletes.length > COLLAPSED_LIMIT

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <ul className="space-y-0.5">
        {visible.map((a) => (
          <li key={a.bib} className="text-sm text-foreground">
            #{a.bib} {a.fullName}
            {a.division ? (
              <span className="text-muted-foreground"> ({a.division})</span>
            ) : null}
          </li>
        ))}
      </ul>
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="h-auto py-0.5 px-1 text-xs"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? 'Show fewer' : `Show all ${athletes.length}`}
        </Button>
      )}
    </div>
  )
}
