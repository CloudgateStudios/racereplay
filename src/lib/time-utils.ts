/**
 * Parse a time string into total seconds.
 * Handles "H:MM:SS", "HH:MM:SS", "MM:SS", "--", "", null, undefined.
 * Returns an integer number of seconds, or null if unparseable.
 */
export function parseTime(str: string | null | undefined): number | null {
  if (str == null) return null
  const s = str.trim()
  if (s === '' || s === '--' || s === '-') return null

  const parts = s.split(':')
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10)
    const sec = parseInt(parts[2], 10)
    if (isNaN(h) || isNaN(m) || isNaN(sec)) return null
    if (m < 0 || m > 59 || sec < 0 || sec > 59) return null
    return Math.round(h * 3600 + m * 60 + sec)
  }

  if (parts.length === 2) {
    const m = parseInt(parts[0], 10)
    const sec = parseInt(parts[1], 10)
    if (isNaN(m) || isNaN(sec)) return null
    if (sec < 0 || sec > 59) return null
    return Math.round(m * 60 + sec)
  }

  return null
}

/**
 * Format total seconds into "H:MM:SS" string.
 * Example: 3754 → "1:02:34"
 */
export function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Format total seconds into "M:SS" string for short legs like T1/T2.
 * Example: 154 → "2:34"
 */
export function formatTimeMM(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
