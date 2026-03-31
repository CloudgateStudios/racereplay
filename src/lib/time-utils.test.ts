import { describe, it, expect } from 'vitest'
import { parseTime, formatTime, formatTimeMM } from './time-utils'

describe('parseTime', () => {
  it('parses standard HH:MM:SS', () => {
    expect(parseTime('01:02:34')).toBe(3754)
  })

  it('parses H:MM:SS (no leading zero on hours)', () => {
    expect(parseTime('1:02:34')).toBe(3754)
  })

  it('parses MM:SS format', () => {
    expect(parseTime('2:34')).toBe(154)
  })

  it('returns null for "--"', () => {
    expect(parseTime('--')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseTime('')).toBeNull()
  })

  it('returns null for null', () => {
    expect(parseTime(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(parseTime(undefined)).toBeNull()
  })

  it('handles 0 seconds', () => {
    expect(parseTime('0:00:00')).toBe(0)
  })

  it('handles exactly 1 hour', () => {
    expect(parseTime('1:00:00')).toBe(3600)
  })

  it('handles large hour values', () => {
    expect(parseTime('10:30:45')).toBe(37845)
  })

  it('returns null for "-" (single dash)', () => {
    expect(parseTime('-')).toBeNull()
  })

  it('returns null for non-numeric strings', () => {
    expect(parseTime('abc')).toBeNull()
  })

  it('trims whitespace before parsing', () => {
    expect(parseTime(' 1:02:34 ')).toBe(3754)
  })
})

describe('formatTime', () => {
  it('formats 3754 seconds as "1:02:34"', () => {
    expect(formatTime(3754)).toBe('1:02:34')
  })

  it('formats 0 seconds as "0:00:00"', () => {
    expect(formatTime(0)).toBe('0:00:00')
  })

  it('formats exactly 1 hour', () => {
    expect(formatTime(3600)).toBe('1:00:00')
  })

  it('round-trips parseTime → formatTime for HH:MM:SS', () => {
    const input = '2:15:30'
    const secs = parseTime(input)!
    expect(formatTime(secs)).toBe('2:15:30')
  })

  it('round-trips parseTime → formatTime for H:MM:SS with leading zeros', () => {
    const secs = parseTime('1:05:09')!
    expect(formatTime(secs)).toBe('1:05:09')
  })

  it('pads minutes and seconds with leading zeros', () => {
    expect(formatTime(3661)).toBe('1:01:01')
  })
})

describe('formatTimeMM', () => {
  it('formats 154 seconds as "2:34"', () => {
    expect(formatTimeMM(154)).toBe('2:34')
  })

  it('formats 0 seconds as "0:00"', () => {
    expect(formatTimeMM(0)).toBe('0:00')
  })

  it('formats 60 seconds as "1:00"', () => {
    expect(formatTimeMM(60)).toBe('1:00')
  })

  it('pads seconds with leading zero', () => {
    expect(formatTimeMM(65)).toBe('1:05')
  })
})
