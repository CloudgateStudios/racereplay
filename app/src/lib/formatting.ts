/**
 * Shared formatting utilities used across event results and athlete detail pages.
 */

/**
 * Formats a duration in seconds as a human-readable time string.
 *
 * - Returns "—" for null input.
 * - Returns "m:ss" for durations under one hour.
 * - Returns "h:mm:ss" for durations of one hour or more.
 *
 * @example
 * formatSeconds(null)   // "—"
 * formatSeconds(0)      // "0:00"
 * formatSeconds(75)     // "1:15"
 * formatSeconds(3661)   // "1:01:01"
 */
export function formatSeconds(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Returns a Tailwind text color class based on the sign of a net passing value.
 *
 * - Positive → green (gained positions)
 * - Negative → red (lost positions)
 * - Zero or null → empty string (no color applied)
 */
export function netColor(net: number | null): string {
  if (net == null || net === 0) return "";
  return net > 0 ? "text-green-600" : "text-red-500";
}

/**
 * Formats a net passing value for display.
 *
 * - Returns "—" for null.
 * - Prefixes positive values with "+".
 * - Negative values are returned as-is (e.g. "-3").
 */
export function netLabel(net: number | null): string {
  if (net == null) return "—";
  if (net > 0) return `+${net}`;
  return String(net);
}
