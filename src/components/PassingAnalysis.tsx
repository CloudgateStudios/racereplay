'use client'

import { LegCard } from '@/components/LegCard'
import type { AthleteAnalysisResponse } from '@/types'

interface PassingAnalysisProps {
  data: AthleteAnalysisResponse
}

export function PassingAnalysis({ data }: PassingAnalysisProps) {
  const { race, result, passing } = data

  if (!passing) {
    return (
      <p className="text-sm text-muted-foreground">
        No passing data available for this athlete.
      </p>
    )
  }

  const legs = race.legs

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex items-center gap-4 flex-wrap text-sm">
        {result.overallRank != null && (
          <span>
            Overall rank: <strong>#{result.overallRank}</strong>
          </span>
        )}
        {passing.overall != null && (
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
      </div>

      {/* One card per leg — driven entirely by race.legs, never hardcoded */}
      {legs.map((legName, i) => {
        const legPassing = passing[legName]
        const splitSecs = result.splits?.[legName]
        // splitRanks covers all legs except the final one (whose rank == overallRank)
        const isLastLeg = i === legs.length - 1
        const rank = isLastLeg
          ? result.overallRank
          : result.splitRanks?.[legName]

        if (!legPassing) {
          // Leg not present (e.g. DNF athlete who dropped before this leg)
          return null
        }

        return (
          <LegCard
            key={legName}
            legName={legName}
            splitSecs={splitSecs}
            rank={rank}
            gained={legPassing.gained}
            lost={legPassing.lost}
            passedAthletes={legPassing.passedAthletes}
            passedByAthletes={legPassing.passedByAthletes}
          />
        )
      })}
    </div>
  )
}
