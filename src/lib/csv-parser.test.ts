import { describe, it, expect } from 'vitest'
import { parseCSV } from './csv-parser'

function makeBuf(str: string): Buffer {
  return Buffer.from(str, 'utf-8')
}

describe('parseCSV — triathlon CSV (5 legs)', () => {
  const csv = `Bib Number,Athlete Name,Gender,Country,Division,Status,Finish Time,Overall Rank,Gender Rank,Division Rank,Wave Offset (Seconds),Finish (Seconds),Swim (Seconds),T1 (Seconds),Bike (Seconds),T2 (Seconds),Run (Seconds)
1,Alice Smith,F,US,F30-34,FIN,4:30:00,5,2,1,120,16200,1800,180,7200,120,6900
2,Bob Jones,M,CA,M40-44,FIN,4:15:00,3,3,2,0,15300,1700,200,7000,100,6300
3,Carol Doe,F,UK,F25-29,DNF,--,,,, 60,,,1900,200,,`

  const { legs, results } = parseCSV(makeBuf(csv))

  it('detects 5 legs in correct order', () => {
    expect(legs).toEqual(['Swim', 'T1', 'Bike', 'T2', 'Run'])
  })

  it('returns 3 results', () => {
    expect(results.length).toBe(3)
  })

  it('parses finisher splits correctly', () => {
    const alice = results.find((r) => r.bib === '1')!
    expect(alice.splits).toEqual({ Swim: 1800, T1: 180, Bike: 7200, T2: 120, Run: 6900 })
  })

  it('parses waveOffset', () => {
    const alice = results.find((r) => r.bib === '1')!
    expect(alice.waveOffset).toBe(120)
    const bob = results.find((r) => r.bib === '2')!
    expect(bob.waveOffset).toBe(0)
  })

  it('parses ranks', () => {
    const alice = results.find((r) => r.bib === '1')!
    expect(alice.overallRank).toBe(5)
    expect(alice.genderRank).toBe(2)
    expect(alice.divisionRank).toBe(1)
  })

  it('parses finishSecs', () => {
    const alice = results.find((r) => r.bib === '1')!
    expect(alice.finishSecs).toBe(16200)
  })

  it('sets status for finisher', () => {
    const alice = results.find((r) => r.bib === '1')!
    expect(alice.status).toBe('FIN')
  })
})

describe('parseCSV — DNF athlete', () => {
  const csv = `Bib Number,Athlete Name,Status,Swim (Seconds),T1 (Seconds),Bike (Seconds),T2 (Seconds),Run (Seconds)
1,Finisher,FIN,1800,180,7200,120,6900
2,DNFer,DNF,1900,200,--,--,--
3,EarlyDNF,DNF,2000,--,--,--,--`

  const { legs, results } = parseCSV(makeBuf(csv))

  it('detects 5 legs', () => {
    expect(legs).toEqual(['Swim', 'T1', 'Bike', 'T2', 'Run'])
  })

  it('finisher has all 5 legs in splits', () => {
    const f = results.find((r) => r.bib === '1')!
    expect(Object.keys(f.splits)).toHaveLength(5)
  })

  it('DNF athlete missing Bike onward', () => {
    const d = results.find((r) => r.bib === '2')!
    expect(d.splits['Swim']).toBe(1900)
    expect(d.splits['T1']).toBe(200)
    expect(d.splits['Bike']).toBeUndefined()
    expect(d.splits['T2']).toBeUndefined()
    expect(d.splits['Run']).toBeUndefined()
  })

  it('early DNF has only Swim', () => {
    const e = results.find((r) => r.bib === '3')!
    expect(Object.keys(e.splits).length).toBeGreaterThan(0)
    expect(e.splits['Swim']).toBe(2000)
    expect(e.splits['T1']).toBeUndefined()
  })

  it('DNF status set', () => {
    const d = results.find((r) => r.bib === '2')!
    expect(d.status).toBe('DNF')
  })
})

describe('parseCSV — flexible column names', () => {
  it('accepts "Bib" instead of "Bib Number"', () => {
    const csv = `Bib,Name,Swim (Seconds),Run (Seconds)
42,Test Athlete,1500,3600`
    const { results } = parseCSV(makeBuf(csv))
    expect(results[0].bib).toBe('42')
    expect(results[0].fullName).toBe('Test Athlete')
  })

  it('accepts "Athlete" column name', () => {
    const csv = `Bib Number,Athlete,Swim (Seconds)
5,John Doe,1800`
    const { results } = parseCSV(makeBuf(csv))
    expect(results[0].fullName).toBe('John Doe')
  })

  it('accepts "Pos" for overall rank', () => {
    const csv = `Bib,Name,Pos,Swim (Seconds)
1,Racer One,42,1800`
    const { results } = parseCSV(makeBuf(csv))
    expect(results[0].overallRank).toBe(42)
  })

  it('accepts "Age Group" for division', () => {
    const csv = `Bib,Name,Age Group,Swim (Seconds)
7,Racer Seven,M35-39,1700`
    const { results } = parseCSV(makeBuf(csv))
    expect(results[0].division).toBe('M35-39')
  })

  it('accepts "Sex" for gender', () => {
    const csv = `Bib,Name,Sex,Swim (Seconds)
3,Racer Three,F,1600`
    const { results } = parseCSV(makeBuf(csv))
    expect(results[0].gender).toBe('F')
  })
})

describe('parseCSV — leg detection', () => {
  it('does not treat Finish (Seconds) as a leg', () => {
    const csv = `Bib,Name,Finish (Seconds),Swim (Seconds),Run (Seconds)
1,Athlete,3600,1200,2400`
    const { legs } = parseCSV(makeBuf(csv))
    expect(legs).not.toContain('Finish')
    expect(legs).toEqual(['Swim', 'Run'])
  })

  it('does not treat Finish Gun (Seconds) as a leg', () => {
    const csv = `Bib,Name,Finish Gun (Seconds),5K (Seconds)
1,Athlete,1800,900`
    const { legs } = parseCSV(makeBuf(csv))
    expect(legs).not.toContain('Finish Gun')
    expect(legs).toEqual(['5K'])
  })

  it('does not treat Wave Offset (Seconds) as a leg', () => {
    const csv = `Bib,Name,Wave Offset (Seconds),Swim (Seconds)
1,Athlete,120,1800`
    const { legs } = parseCSV(makeBuf(csv))
    expect(legs).not.toContain('Wave Offset')
    expect(legs).toEqual(['Swim'])
  })

  it('handles road-race 2-leg format', () => {
    const csv = `Bib,Name,5K (Seconds),10K (Seconds)
1,Runner A,1200,1300
2,Runner B,1100,1400`
    const { legs, results } = parseCSV(makeBuf(csv))
    expect(legs).toEqual(['5K', '10K'])
    expect(results[0].splits['5K']).toBe(1200)
    expect(results[0].splits['10K']).toBe(1300)
  })
})

describe('parseCSV — empty/edge cases', () => {
  it('returns empty for empty buffer', () => {
    const { legs, results } = parseCSV(makeBuf(''))
    expect(legs).toEqual([])
    expect(results).toEqual([])
  })

  it('returns empty for header-only CSV', () => {
    const { legs, results } = parseCSV(makeBuf('Bib,Name,Swim (Seconds)'))
    expect(legs).toEqual(['Swim'])
    expect(results).toEqual([])
  })

  it('skips rows with no bib', () => {
    const csv = `Bib,Name,Swim (Seconds)
,No Bib Athlete,1800
42,Has Bib,1700`
    const { results } = parseCSV(makeBuf(csv))
    expect(results.length).toBe(1)
    expect(results[0].bib).toBe('42')
  })
})
