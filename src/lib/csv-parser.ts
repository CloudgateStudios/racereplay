import type { RawResult } from '@/types/index'
import { parseTime } from './time-utils'

type ParsedCSV = {
  legs: string[]
  results: RawResult[]
}

/**
 * Normalize a CSV header to a canonical lowercase key for matching.
 * Strips spaces and non-alphanumeric characters.
 */
function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9()]/g, '')
}

/**
 * Parse a CSV buffer into legs array and RawResult array.
 *
 * Column detection:
 * - Flexible column name variants (see API_SPEC.md)
 * - Leg detection: any column ending in "(Seconds)" except
 *   "Finish (Seconds)", "Finish Gun (Seconds)", "Wave Offset (Seconds)"
 * - Leg columns must appear in column order
 *
 * DNF/DNS: "--" or empty in time fields → leg omitted from splits
 */
export function parseCSV(buffer: Buffer): ParsedCSV {
  const text = buffer.toString('utf-8')
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')

  if (lines.length < 1) {
    return { legs: [], results: [] }
  }

  // Parse CSV respecting quoted fields
  function parseCsvLine(line: string): string[] {
    const fields: string[] = []
    let current = ''
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuote = !inQuote
        }
      } else if (ch === ',' && !inQuote) {
        fields.push(current)
        current = ''
      } else {
        current += ch
      }
    }
    fields.push(current)
    return fields
  }

  const rawHeaders = parseCsvLine(lines[0])
  const headers = rawHeaders.map((h) => h.trim())
  const normHeaders = headers.map(normalizeHeader)

  // Column index finders
  function findCol(variants: string[]): number {
    const normVariants = variants.map(normalizeHeader)
    for (const nv of normVariants) {
      const idx = normHeaders.indexOf(nv)
      if (idx !== -1) return idx
    }
    return -1
  }

  // Identify fixed columns
  const colBib      = findCol(['Bib Number', 'Bib', 'BibNumber', 'bib_number'])
  const colName     = findCol(['Athlete Name', 'Name', 'Athlete', 'athlete_name'])
  const colGender   = findCol(['Gender', 'Sex'])
  const colCountry  = findCol(['Country', 'Nationality'])
  const colDivision = findCol(['Division', 'Div', 'Age Group', 'AgeGroup'])
  const colStatus   = findCol(['Status'])
  const colFinish   = findCol(['Finish Time', 'Finish'])
  const colOverall  = findCol(['Overall Rank', 'Pos', 'Position', 'OverallRank'])
  const colGenderR  = findCol(['Gender Rank', 'GenderRank'])
  const colDivisionR = findCol(['Division Rank', 'DivisionRank'])
  const colWaveOffset = findCol(['Wave Offset (Seconds)', 'WaveOffset(Seconds)'])
  const colFinishSecs = findCol(['Finish (Seconds)', 'Finish(Seconds)'])

  // Excluded from leg detection
  const EXCLUDED_SUFFIXES = [
    normalizeHeader('Finish (Seconds)'),
    normalizeHeader('Finish Gun (Seconds)'),
    normalizeHeader('Wave Offset (Seconds)'),
  ]

  // Detect leg columns: any column ending in "(seconds)" (case-insensitive) that is NOT excluded
  const SECONDS_SUFFIX = '(seconds)'
  const legColumns: Array<{ index: number; legName: string }> = []

  for (let i = 0; i < headers.length; i++) {
    const norm = normHeaders[i]
    if (!norm.endsWith(SECONDS_SUFFIX)) continue
    if (EXCLUDED_SUFFIXES.includes(norm)) continue

    // Leg name = original header text with " (Seconds)" stripped
    const originalHeader = headers[i]
    const legName = originalHeader.replace(/\s*\(seconds\)\s*$/i, '').trim()
    legColumns.push({ index: i, legName })
  }

  const legs = legColumns.map((lc) => lc.legName)

  // Parse rows
  const results: RawResult[] = []

  for (let lineIdx = 1; lineIdx < lines.length; lineIdx++) {
    const row = parseCsvLine(lines[lineIdx])
    if (row.length === 0) continue

    const get = (idx: number): string => (idx >= 0 && idx < row.length ? row[idx].trim() : '')

    const bib = get(colBib)
    const fullName = get(colName)

    if (!bib) continue

    // Build splits — only include legs with parseable values
    const splits: Record<string, number> = {}
    for (const { index, legName } of legColumns) {
      const raw = get(index)
      if (!raw || raw === '--' || raw === '-') {
        // DNF at this leg — stop adding further legs
        break
      }
      const secs = parseInt(raw, 10)
      if (!isNaN(secs) && secs >= 0) {
        splits[legName] = secs
      } else {
        // Try parsing as time string
        const parsed = parseTime(raw)
        if (parsed != null) {
          splits[legName] = parsed
        } else {
          break  // unparseable = DNF at this leg
        }
      }
    }

    // Finish seconds
    let finishSecs: number | undefined
    if (colFinishSecs >= 0) {
      const raw = get(colFinishSecs)
      if (raw && raw !== '--') {
        const n = parseInt(raw, 10)
        if (!isNaN(n)) finishSecs = n
      }
    }
    if (finishSecs == null && colFinish >= 0) {
      const raw = get(colFinish)
      if (raw && raw !== '--') {
        const parsed = parseTime(raw)
        if (parsed != null) finishSecs = parsed
      }
    }

    // Wave offset
    let waveOffset: number | undefined
    if (colWaveOffset >= 0) {
      const raw = get(colWaveOffset)
      if (raw && raw !== '--') {
        const n = parseFloat(raw)
        if (!isNaN(n)) waveOffset = n
      }
    }

    // Status
    const statusRaw = get(colStatus).toUpperCase()
    let status: RawResult['status']
    if (['FIN', 'DNF', 'DNS', 'DSQ'].includes(statusRaw)) {
      status = statusRaw as RawResult['status']
    } else if (statusRaw === '') {
      status = Object.keys(splits).length === legs.length ? 'FIN' : 'DNF'
    }

    // Ranks
    const overallRankRaw = get(colOverall)
    const overallRank = overallRankRaw ? parseInt(overallRankRaw, 10) || undefined : undefined
    const genderRankRaw = get(colGenderR)
    const genderRank = genderRankRaw ? parseInt(genderRankRaw, 10) || undefined : undefined
    const divisionRankRaw = get(colDivisionR)
    const divisionRank = divisionRankRaw ? parseInt(divisionRankRaw, 10) || undefined : undefined

    results.push({
      bib,
      fullName: fullName || bib,
      gender: get(colGender) || undefined,
      country: get(colCountry) || undefined,
      division: get(colDivision) || undefined,
      status,
      finishSecs,
      waveOffset,
      overallRank,
      genderRank,
      divisionRank,
      splits,
    })
  }

  return { legs, results }
}
