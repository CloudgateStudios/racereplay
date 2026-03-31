import type { RawResult, PassingData, LegPassingStats } from '@/types/index'

/**
 * Compute passing data for all athletes in a race.
 *
 * Pure function — no DB access. Receives the full race field and returns a
 * map from bib → PassingData.
 *
 * Physical mode (hasWaveData=true):
 *   position = waveOffset + cumulativeChipSecs
 *   Swim "before" position = waveOffset alone (who was already in the water)
 *
 * Chip-only mode (hasWaveData=false):
 *   waveOffset = 0 for all athletes
 *
 * passedBibs = bibs where before[bib] < before[X] AND after[bib] > after[X]
 *   (bib was ahead of X before, behind X after — X passed them)
 *
 * passedByBibs = bibs where before[bib] > before[X] AND after[bib] < after[X]
 *   (bib was behind X before, ahead of X after — they passed X)
 *
 * DNF athletes: excluded from legs where their splits are missing.
 */
export function computePassingData(
  athletes: RawResult[],
  legs: string[],
  hasWaveData: boolean
): Map<string, PassingData> {
  const result = new Map<string, PassingData>()

  // For each athlete, build cumulative chip seconds up to each leg boundary
  // cumulativeAt[bib][legIndex] = cumulative chip secs after leg `legIndex`
  // cumulativeAt[bib][-1] = 0 (before race start)
  // An athlete is eligible at leg i if they have splits[0..i] all defined

  const effectiveWaveOffset = (a: RawResult): number => {
    if (hasWaveData && a.waveOffset != null) return a.waveOffset
    return 0
  }

  // Compute cumulative chip seconds after each leg for each athlete
  // Returns array of length `legs.length`, where entry i = cumulative secs after leg i
  // If the athlete is missing a leg split (DNF), that entry and all subsequent are null
  function cumulativeSecs(a: RawResult): (number | null)[] {
    const cumulative: (number | null)[] = []
    let sum = 0
    for (const leg of legs) {
      const legSecs = a.splits[leg]
      if (legSecs == null) {
        // Fill rest with null
        while (cumulative.length < legs.length) cumulative.push(null)
        return cumulative
      }
      sum += legSecs
      cumulative.push(sum)
    }
    return cumulative
  }

  // Build position snapshots for each leg
  // positionBefore[i] = physical position at start of leg i
  // positionAfter[i] = physical position at end of leg i
  // A "position" is the number of seconds since the earliest starter that
  // the athlete was at that course location. Lower = further ahead.

  // For leg i:
  //   positionBefore[0 (first leg)] = waveOffset
  //   positionBefore[i > 0] = waveOffset + cumulative[i-1]
  //   positionAfter[i] = waveOffset + cumulative[i]

  // Build a map of bib → cumulative secs array
  const cumMap = new Map<string, (number | null)[]>()
  for (const a of athletes) {
    cumMap.set(a.bib, cumulativeSecs(a))
  }

  // Initialize result map
  for (const a of athletes) {
    const legStats: Record<string, LegPassingStats> = {}
    for (const leg of legs) {
      legStats[leg] = { gained: 0, lost: 0, passedBibs: [], passedByBibs: [] }
    }
    result.set(a.bib, {
      legs: legStats,
      overall: { finishRank: 0, netGained: 0 },
    })
  }

  // For each leg, compute passing
  for (let legIdx = 0; legIdx < legs.length; legIdx++) {
    const legName = legs[legIdx]

    // Collect eligible athletes for this leg (must have a valid position before AND after)
    type EligibleAthlete = {
      bib: string
      positionBefore: number
      positionAfter: number
    }

    const eligible: EligibleAthlete[] = []

    for (const a of athletes) {
      const waveOff = effectiveWaveOffset(a)
      const cum = cumMap.get(a.bib)!

      // positionAfter: need cum[legIdx] to be non-null
      const cumAfter = cum[legIdx]
      if (cumAfter == null) continue

      // positionBefore:
      // - For leg 0 (first leg): positionBefore = waveOffset
      // - For leg i > 0: need cum[legIdx - 1] to be non-null
      let posBefore: number
      if (legIdx === 0) {
        posBefore = waveOff
      } else {
        const cumBefore = cum[legIdx - 1]
        if (cumBefore == null) continue
        posBefore = waveOff + cumBefore
      }

      const posAfter = waveOff + cumAfter

      eligible.push({ bib: a.bib, positionBefore: posBefore, positionAfter: posAfter })
    }

    // For each pair of eligible athletes, determine passing
    // O(n^2) — this is acceptable for typical race sizes (<=5000 athletes)
    // and is only run once at import time
    for (let i = 0; i < eligible.length; i++) {
      const x = eligible[i]
      const xData = result.get(x.bib)!
      const xLegStats = xData.legs[legName]

      for (let j = 0; j < eligible.length; j++) {
        if (i === j) continue
        const other = eligible[j]

        // X passed `other` if:
        // before: other was AHEAD of X (other.before < x.before)
        // after: other is BEHIND X (other.after > x.after)
        if (other.positionBefore < x.positionBefore && other.positionAfter > x.positionAfter) {
          xLegStats.gained++
          xLegStats.passedBibs.push(other.bib)
        }

        // `other` passed X if:
        // before: other was BEHIND X (other.before > x.before)
        // after: other is AHEAD of X (other.after < x.after)
        if (other.positionBefore > x.positionBefore && other.positionAfter < x.positionAfter) {
          xLegStats.lost++
          xLegStats.passedByBibs.push(other.bib)
        }
      }
    }
  }

  // Compute overall stats (finishRank and netGained)
  // finishRank: rank among all athletes by cumulative chip time (ascending)
  // Use the last leg's cumulative time as the finish time
  const finishers: Array<{ bib: string; finishCum: number }> = []
  for (const a of athletes) {
    const cum = cumMap.get(a.bib)!
    const lastCum = cum[legs.length - 1]
    if (lastCum != null) {
      finishers.push({ bib: a.bib, finishCum: lastCum })
    }
  }

  // Sort by cumulative chip time ascending
  finishers.sort((a, b) => a.finishCum - b.finishCum)
  for (let rank = 0; rank < finishers.length; rank++) {
    const { bib } = finishers[rank]
    const data = result.get(bib)!
    data.overall.finishRank = rank + 1

    // Compute netGained
    let net = 0
    for (const leg of legs) {
      const legStats = data.legs[leg]
      net += legStats.gained - legStats.lost
    }
    data.overall.netGained = net
  }

  return result
}
