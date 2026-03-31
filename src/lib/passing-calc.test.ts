import { describe, it, expect } from 'vitest'
import { computePassingData } from './passing-calc'
import type { RawResult } from '@/types/index'

// Helper: sum up gained or lost across all athletes for a given leg
function sumGained(map: ReturnType<typeof computePassingData>, leg: string): number {
  let total = 0
  for (const data of map.values()) {
    total += data.legs[leg]?.gained ?? 0
  }
  return total
}

function sumLost(map: ReturnType<typeof computePassingData>, leg: string): number {
  let total = 0
  for (const data of map.values()) {
    total += data.legs[leg]?.lost ?? 0
  }
  return total
}

// Small toy field: 8 athletes, 2 legs (Swim + Run), with wave offsets
// Wave offsets in seconds: athletes start at different times (time-trial start)
// bib  waveOffset  Swim  Run
// A    0           100   200
// B    10          90    210
// C    20          80    220
// D    30          70    230
// E    40          60    240
// F    50          50    250
// G    60          40    260
// H    70          30    270
//
// Physical positions:
// Before Swim: = waveOffset (A=0, B=10, C=20, D=30, E=40, F=50, G=60, H=70)
// After Swim: = waveOffset + swimSecs
//   A: 0+100=100, B: 10+90=100 (tie), C: 20+80=100 (tie), D: 30+70=100 (tie), ...
//   All have position 100 after swim — no passing!
//
// This is a degenerate case. Let's make more interesting splits:

const toyAthletes: RawResult[] = [
  // bib, waveOffset, Swim, Run
  { bib: 'A', fullName: 'Alpha', splits: { Swim: 100, Run: 300 }, waveOffset: 0 },
  { bib: 'B', fullName: 'Beta',  splits: { Swim: 120, Run: 200 }, waveOffset: 0 },
  { bib: 'C', fullName: 'Gamma', splits: { Swim: 80,  Run: 350 }, waveOffset: 0 },
  { bib: 'D', fullName: 'Delta', splits: { Swim: 90,  Run: 250 }, waveOffset: 0 },
  { bib: 'E', fullName: 'Echo',  splits: { Swim: 110, Run: 220 }, waveOffset: 0 },
  { bib: 'F', fullName: 'Foxt',  splits: { Swim: 70,  Run: 400 }, waveOffset: 0 },
  { bib: 'G', fullName: 'Golf',  splits: { Swim: 150, Run: 180 }, waveOffset: 0 },
  { bib: 'H', fullName: 'Hotel', splits: { Swim: 60,  Run: 500 }, waveOffset: 0 },
]

// Chip-only mode (waveOffset=0, chip-time rank comparison)
// Swim rank order (by swimSecs asc): H(60) < F(70) < C(80) < D(90) < A(100) < E(110) < B(120) < G(150)
// After run — cumulative finish:
//   H: 560, F: 470, C: 430, D: 340, A: 400, E: 330, B: 320, G: 330
// After run asc: B(320) < E(330) = G(330) < D(340) < A(400) < C(430) < F(470) < H(560)

describe('computePassingData — chip-only mode', () => {
  const legs = ['Swim', 'Run']
  const result = computePassingData(toyAthletes, legs, false)

  it('returns a map entry for every athlete', () => {
    expect(result.size).toBe(toyAthletes.length)
  })

  it('invariant: sum(gained) === sum(lost) for Swim leg', () => {
    expect(sumGained(result, 'Swim')).toBe(sumLost(result, 'Swim'))
  })

  it('invariant: sum(gained) === sum(lost) for Run leg', () => {
    expect(sumGained(result, 'Run')).toBe(sumLost(result, 'Run'))
  })

  it('bib B gained positions during Run (ran fastest)', () => {
    // B was 7th after swim (swimSecs=120), but finished 1st overall
    // So B passed many people during Run
    const b = result.get('B')!
    expect(b.legs['Run'].gained).toBeGreaterThan(0)
  })

  it('bib H lost positions during Run (swam fast but ran slowest)', () => {
    // H was 1st after swim (swimSecs=60), but finished last overall (cumulative=560)
    const h = result.get('H')!
    expect(h.legs['Run'].lost).toBeGreaterThan(0)
  })

  it('passedBibs and passedByBibs are arrays', () => {
    for (const [, data] of result) {
      for (const leg of legs) {
        expect(Array.isArray(data.legs[leg].passedBibs)).toBe(true)
        expect(Array.isArray(data.legs[leg].passedByBibs)).toBe(true)
      }
    }
  })

  it('passedBibs count matches gained count', () => {
    for (const [, data] of result) {
      for (const leg of legs) {
        expect(data.legs[leg].passedBibs.length).toBe(data.legs[leg].gained)
        expect(data.legs[leg].passedByBibs.length).toBe(data.legs[leg].lost)
      }
    }
  })
})

describe('computePassingData — physical mode with wave offsets', () => {
  // Wave offsets change the "physical position" calculation
  // Athletes with later wave starts are physically behind at the start of Swim
  const physicalAthletes: RawResult[] = [
    { bib: 'A', fullName: 'Alpha', splits: { Swim: 100, Run: 300 }, waveOffset: 0 },
    { bib: 'B', fullName: 'Beta',  splits: { Swim: 100, Run: 200 }, waveOffset: 60 },
    { bib: 'C', fullName: 'Gamma', splits: { Swim: 100, Run: 400 }, waveOffset: 120 },
  ]

  const legs = ['Swim', 'Run']
  const result = computePassingData(physicalAthletes, legs, true)

  it('invariant: sum(gained) === sum(lost) for Swim leg', () => {
    expect(sumGained(result, 'Swim')).toBe(sumLost(result, 'Swim'))
  })

  it('invariant: sum(gained) === sum(lost) for Run leg', () => {
    expect(sumGained(result, 'Run')).toBe(sumLost(result, 'Run'))
  })

  it('physical positions are wave-offset aware', () => {
    // After swim: A=0+100=100, B=60+100=160, C=120+100=220
    // All same swim time, but wave offsets separate them — no swim passing
    const a = result.get('A')!
    const b = result.get('B')!
    const c = result.get('C')!
    // No swim passing because the relative order doesn't change
    expect(a.legs['Swim'].gained).toBe(0)
    expect(b.legs['Swim'].gained).toBe(0)
    expect(c.legs['Swim'].gained).toBe(0)
  })
})

describe('computePassingData — 2-leg config (non-triathlon)', () => {
  const athletes: RawResult[] = [
    { bib: '1', fullName: 'One',   splits: { '5K': 1200, 'Finish': 1000 }, waveOffset: 0 },
    { bib: '2', fullName: 'Two',   splits: { '5K': 1000, 'Finish': 1300 }, waveOffset: 0 },
    { bib: '3', fullName: 'Three', splits: { '5K': 1100, 'Finish': 1100 }, waveOffset: 0 },
  ]

  const legs = ['5K', 'Finish']
  const result = computePassingData(athletes, legs, false)

  it('works with 2-leg config', () => {
    expect(result.size).toBe(3)
  })

  it('invariant: sum(gained) === sum(lost) for 5K', () => {
    expect(sumGained(result, '5K')).toBe(sumLost(result, '5K'))
  })

  it('invariant: sum(gained) === sum(lost) for Finish', () => {
    expect(sumGained(result, 'Finish')).toBe(sumLost(result, 'Finish'))
  })

  it('bib 1 passed bib 2 in Finish leg', () => {
    // After 5K: 2(1000) < 3(1100) < 1(1200) — bib 2 is fastest, bib 1 slowest
    // After Finish: 1(2200) < 3(2200 tie) < 2(2300) — bib 2 drops back
    // Bib 1 started behind bib 2 in 5K (1>2 chip), bib 1 finishes ahead of bib 2 (1<2 cumulative)
    // So bib 1 passed bib 2 during Finish
    const bib1 = result.get('1')!
    expect(bib1.legs['Finish'].passedBibs).toContain('2')
  })
})

describe('computePassingData — DNF athlete', () => {
  const athletes: RawResult[] = [
    { bib: 'A', fullName: 'Alpha',   splits: { Swim: 100, Bike: 300, Run: 200 }, waveOffset: 0 },
    { bib: 'B', fullName: 'Beta',    splits: { Swim: 90,  Bike: 310, Run: 210 }, waveOffset: 0 },
    { bib: 'DNF', fullName: 'DNF-er', splits: { Swim: 80 }, waveOffset: 0 },  // DNF after Swim
  ]

  const legs = ['Swim', 'Bike', 'Run']
  const result = computePassingData(athletes, legs, false)

  it('DNF athlete has Swim stats (they completed Swim)', () => {
    const dnf = result.get('DNF')!
    // DNF athlete participated in Swim leg
    expect(dnf.legs['Swim']).toBeDefined()
  })

  it('DNF athlete is excluded from Bike and Run legs (no position data)', () => {
    const dnf = result.get('DNF')!
    // DNF has no splits for Bike/Run, so gained/lost should be 0
    expect(dnf.legs['Bike'].gained).toBe(0)
    expect(dnf.legs['Bike'].lost).toBe(0)
    expect(dnf.legs['Run'].gained).toBe(0)
    expect(dnf.legs['Run'].lost).toBe(0)
  })

  it('non-DNF athletes do not include DNF in their Bike passing stats', () => {
    const a = result.get('A')!
    const b = result.get('B')!
    expect(a.legs['Bike'].passedBibs).not.toContain('DNF')
    expect(a.legs['Bike'].passedByBibs).not.toContain('DNF')
    expect(b.legs['Bike'].passedBibs).not.toContain('DNF')
  })

  it('invariant holds for all legs including DNF field', () => {
    expect(sumGained(result, 'Swim')).toBe(sumLost(result, 'Swim'))
    expect(sumGained(result, 'Bike')).toBe(sumLost(result, 'Bike'))
    expect(sumGained(result, 'Run')).toBe(sumLost(result, 'Run'))
  })
})

describe('computePassingData — exact passedBibs verification', () => {
  // Deterministic toy field where we can predict exact results
  // Chip-only mode, 1 leg, 4 athletes
  // swimSecs: A=100, B=80, C=120, D=90
  // Swim rank order (asc): B(80) < D(90) < A(100) < C(120)
  // No "before swim" passing differences with chip-only (all wave=0, all start at position 0)
  // After swim: B=80, D=90, A=100, C=120
  // Before swim: all=0 (waveOffset=0 for all)
  //
  // Wait — in chip-only mode before Swim, ALL athletes have position=waveOffset=0.
  // There are no differences in "before" position, so no passing can occur during Swim.
  // This is mathematically correct: with chip-only timing and same start position,
  // swim passing is purely by chip time rank, but the "before" all being equal means
  // no relative passing. That's the correct interpretation.
  //
  // Let's use 2 legs to get interesting passing:
  // splits: leg1, leg2
  // A: 100, 200 → cum after leg1=100, finish=300
  // B: 80,  250 → cum after leg1=80,  finish=330
  // C: 120, 150 → cum after leg1=120, finish=270
  // D: 90,  180 → cum after leg1=90,  finish=270
  //
  // After leg1 rank: B(80) < D(90) < A(100) < C(120)
  // After leg2 rank: C=D(270) < A(300) < B(330)
  //
  // During leg2, position before = waveOffset + cumLeg1 (all waveOffset=0):
  //   B=80, D=90, A=100, C=120
  // Position after = waveOffset + cumFinish:
  //   C=270, D=270, A=300, B=330
  //
  // For athlete A (before=100, after=300):
  //   passedBibs (ahead before, behind after = before<100 AND after>300): B(80,330) → B was ahead of A before AND behind A after → A passed B
  //   passedByBibs (behind before, ahead after = before>100 AND after<300): C(120,270) → C was behind A before AND ahead A after → C passed A
  //
  // Let's verify: A passed B, C passed A
  const fourAthletes: RawResult[] = [
    { bib: 'A', fullName: 'Alpha', splits: { Leg1: 100, Leg2: 200 }, waveOffset: 0 },
    { bib: 'B', fullName: 'Beta',  splits: { Leg1: 80,  Leg2: 250 }, waveOffset: 0 },
    { bib: 'C', fullName: 'Gamma', splits: { Leg1: 120, Leg2: 150 }, waveOffset: 0 },
    { bib: 'D', fullName: 'Delta', splits: { Leg1: 90,  Leg2: 180 }, waveOffset: 0 },
  ]

  const legs = ['Leg1', 'Leg2']
  const result = computePassingData(fourAthletes, legs, false)

  it('A passed B during Leg2', () => {
    const a = result.get('A')!
    expect(a.legs['Leg2'].passedBibs).toContain('B')
  })

  it('C passed A during Leg2', () => {
    const a = result.get('A')!
    expect(a.legs['Leg2'].passedByBibs).toContain('C')
  })

  it('invariant for Leg1', () => {
    expect(sumGained(result, 'Leg1')).toBe(sumLost(result, 'Leg1'))
  })

  it('invariant for Leg2', () => {
    expect(sumGained(result, 'Leg2')).toBe(sumLost(result, 'Leg2'))
  })
})
