import { describe, it, expect } from "vitest";
import { formatSeconds, netColor, netLabel } from "./formatting";

// ─── formatSeconds ────────────────────────────────────────────────────────────

describe("formatSeconds", () => {
  it("returns — for null", () => {
    expect(formatSeconds(null)).toBe("—");
  });

  it("formats zero as 0:00", () => {
    expect(formatSeconds(0)).toBe("0:00");
  });

  it("formats sub-minute durations", () => {
    expect(formatSeconds(45)).toBe("0:45");
  });

  it("formats exactly one minute", () => {
    expect(formatSeconds(60)).toBe("1:00");
  });

  it("formats minutes and seconds", () => {
    expect(formatSeconds(75)).toBe("1:15");
  });

  it("zero-pads seconds below 10", () => {
    expect(formatSeconds(65)).toBe("1:05");
  });

  it("formats exactly one hour", () => {
    expect(formatSeconds(3600)).toBe("1:00:00");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatSeconds(3661)).toBe("1:01:01");
  });

  it("zero-pads minutes and seconds in hh:mm:ss format", () => {
    expect(formatSeconds(3605)).toBe("1:00:05");
  });

  it("handles large values (marathon finish time)", () => {
    // 3h 59m 59s
    expect(formatSeconds(14399)).toBe("3:59:59");
  });

  it("truncates fractional seconds", () => {
    expect(formatSeconds(75.9)).toBe("1:15");
  });
});

// ─── netColor ─────────────────────────────────────────────────────────────────

describe("netColor", () => {
  it("returns empty string for null", () => {
    expect(netColor(null)).toBe("");
  });

  it("returns empty string for zero", () => {
    expect(netColor(0)).toBe("");
  });

  it("returns green class for positive net", () => {
    expect(netColor(1)).toBe("text-green-600");
    expect(netColor(50)).toBe("text-green-600");
  });

  it("returns red class for negative net", () => {
    expect(netColor(-1)).toBe("text-red-500");
    expect(netColor(-50)).toBe("text-red-500");
  });
});

// ─── netLabel ─────────────────────────────────────────────────────────────────

describe("netLabel", () => {
  it("returns — for null", () => {
    expect(netLabel(null)).toBe("—");
  });

  it("returns 0 for zero without a sign prefix", () => {
    expect(netLabel(0)).toBe("0");
  });

  it("prefixes positive values with +", () => {
    expect(netLabel(1)).toBe("+1");
    expect(netLabel(42)).toBe("+42");
  });

  it("returns negative values as-is", () => {
    expect(netLabel(-1)).toBe("-1");
    expect(netLabel(-42)).toBe("-42");
  });
});
