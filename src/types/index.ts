export type RawResult = {
  bib: string
  fullName: string
  gender?: string
  country?: string
  division?: string
  status?: 'FIN' | 'DNF' | 'DNS' | 'DSQ'
  finishSecs?: number
  waveOffset?: number
  overallRank?: number
  genderRank?: number
  divisionRank?: number
  splits: Record<string, number>  // legName → seconds
}

export type LegPassingStats = {
  gained: number
  lost: number
  passedBibs: string[]
  passedByBibs: string[]
}

export type PassingData = {
  legs: Record<string, LegPassingStats>  // keyed by leg name — NOT hardcoded
  overall: {
    finishRank: number
    netGained: number
  }
}

export type RaceListItem = {
  id: string
  slug: string
  name: string
  location: string
  date: string
  distance: 'FULL' | 'HALF'
  passingMode: 'PHYSICAL' | 'CHIP_ONLY'
  legs: string[]
  athleteCount: number
  finisherCount: number
}

export type RaceDetail = RaceListItem & {
  dnfCount: number
  dnsCount: number
}

export type AthleteSearchResult = {
  id: string
  bib: string
  fullName: string
  country?: string
  division: string
  gender: string
  result: {
    finishSecs?: number
    overallRank?: number
    genderRank?: number
    divisionRank?: number
    dns: boolean
    dnf: boolean
    dsq: boolean
  }
}

export type AthleteAnalysisResponse = {
  athlete: {
    id: string
    bib: string
    fullName: string
    country?: string
    division: string
    gender: string
  }
  race: {
    slug: string
    name: string
    date: string
    distance: string
    passingMode: string
    legs: string[]
  }
  result: {
    splits: Record<string, number>
    splitRanks: Record<string, number>
    finishSecs?: number
    waveOffset?: number
    dns: boolean
    dnf: boolean
    dsq: boolean
    overallRank?: number
    genderRank?: number
    divisionRank?: number
  }
  passing: (Record<string, {
    gained: number
    lost: number
    passedAthletes: Array<{ bib: string; fullName: string; division: string }>
    passedByAthletes: Array<{ bib: string; fullName: string; division: string }>
  }> & {
    overall: { finishRank: number; netGained: number }
  }) | null
}
