import { describe, it, expect } from "vitest";
import {
  parseCSVRow,
  parseCSV,
  rowToObj,
  detectLegs,
  timeToSeconds,
  toInt,
  toFloat,
} from "./ingest";

// ─── parseCSVRow ──────────────────────────────────────────────────────────────

describe("parseCSVRow", () => {
  it("parses a simple comma-separated row", () => {
    expect(parseCSVRow("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace from values", () => {
    expect(parseCSVRow(" a , b , c ")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields containing commas", () => {
    expect(parseCSVRow('"Smith, John",42,FIN')).toEqual(["Smith, John", "42", "FIN"]);
  });

  it("handles escaped double-quotes inside quoted fields", () => {
    expect(parseCSVRow('"He said ""hello""",x')).toEqual(['He said "hello"', "x"]);
  });

  it("handles empty fields", () => {
    expect(parseCSVRow("a,,c")).toEqual(["a", "", "c"]);
  });

  it("handles a trailing empty field", () => {
    expect(parseCSVRow("a,b,")).toEqual(["a", "b", ""]);
  });

  it("handles a single value with no commas", () => {
    expect(parseCSVRow("hello")).toEqual(["hello"]);
  });
});

// ─── parseCSV ─────────────────────────────────────────────────────────────────

describe("parseCSV", () => {
  it("splits into headers and rows", () => {
    const csv = "Name,Bib,Time\nAlice,1,1:30:00\nBob,2,1:45:00";
    const { headers, rows } = parseCSV(csv);
    expect(headers).toEqual(["Name", "Bib", "Time"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["Alice", "1", "1:30:00"]);
    expect(rows[1]).toEqual(["Bob", "2", "1:45:00"]);
  });

  it("trims leading/trailing whitespace from the raw string", () => {
    const csv = "  \nName,Bib\nAlice,1\n  ";
    const { headers, rows } = parseCSV(csv);
    expect(headers).toEqual(["Name", "Bib"]);
    expect(rows).toHaveLength(1);
  });

  it("returns empty rows array for a header-only CSV", () => {
    const { headers, rows } = parseCSV("Name,Bib,Time");
    expect(headers).toEqual(["Name", "Bib", "Time"]);
    expect(rows).toHaveLength(0);
  });
});

// ─── rowToObj ─────────────────────────────────────────────────────────────────

describe("rowToObj", () => {
  it("maps headers to row values", () => {
    const headers = ["Name", "Bib", "Status"];
    const row = ["Alice", "101", "FIN"];
    expect(rowToObj(headers, row)).toEqual({ Name: "Alice", Bib: "101", Status: "FIN" });
  });

  it("fills missing values with empty string", () => {
    const headers = ["Name", "Bib", "Status"];
    const row = ["Alice", "101"];
    expect(rowToObj(headers, row)).toEqual({ Name: "Alice", Bib: "101", Status: "" });
  });
});

// ─── detectLegs ───────────────────────────────────────────────────────────────

describe("detectLegs", () => {
  it("extracts leg names from columns ending in ' Time'", () => {
    const headers = ["Bib", "Name", "Swim Time", "Bike Time", "Run Time", "Finish Time"];
    expect(detectLegs(headers)).toEqual(["Swim", "Bike", "Run"]);
  });

  it("skips Overall Finish Time", () => {
    const headers = ["Swim Time", "Overall Finish Time"];
    expect(detectLegs(headers)).toEqual(["Swim"]);
  });

  it("skips Finish Time", () => {
    const headers = ["Swim Time", "Finish Time"];
    expect(detectLegs(headers)).toEqual(["Swim"]);
  });

  it("skips Wave Offset (Seconds)", () => {
    const headers = ["Wave Offset (Seconds)", "Bike Time"];
    expect(detectLegs(headers)).toEqual(["Bike"]);
  });

  it("returns empty array when no leg columns exist", () => {
    const headers = ["Bib", "Name", "Overall Finish Time"];
    expect(detectLegs(headers)).toEqual([]);
  });

  it("handles a triathlon column set correctly", () => {
    const headers = [
      "Bib", "Name", "Gender", "Division",
      "Swim Time", "T1 Time", "Bike Time", "T2 Time", "Run Time",
      "Finish Time", "Overall Finish Time", "Wave Offset (Seconds)",
    ];
    expect(detectLegs(headers)).toEqual(["Swim", "T1", "Bike", "T2", "Run"]);
  });
});

// ─── timeToSeconds ────────────────────────────────────────────────────────────

describe("timeToSeconds", () => {
  it("converts mm:ss format", () => {
    expect(timeToSeconds("1:30")).toBe(90);
  });

  it("converts hh:mm:ss format", () => {
    expect(timeToSeconds("1:30:00")).toBe(5400);
  });

  it("handles zero time", () => {
    expect(timeToSeconds("0:00")).toBe(0);
  });

  it("returns null for non-numeric parts", () => {
    expect(timeToSeconds("abc:def")).toBeNull();
  });

  it("returns null for unsupported part count (single value)", () => {
    expect(timeToSeconds("90")).toBeNull();
  });

  it("handles large hour values", () => {
    expect(timeToSeconds("12:00:00")).toBe(43200);
  });
});

// ─── toInt ────────────────────────────────────────────────────────────────────

describe("toInt", () => {
  it("parses a valid integer string", () => {
    expect(toInt("42")).toBe(42);
  });

  it("parses a negative integer string", () => {
    expect(toInt("-5")).toBe(-5);
  });

  it("returns null for empty string", () => {
    expect(toInt("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(toInt(undefined)).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(toInt("abc")).toBeNull();
  });

  it("truncates floats to integer", () => {
    expect(toInt("3.9")).toBe(3);
  });
});

// ─── toFloat ─────────────────────────────────────────────────────────────────

describe("toFloat", () => {
  it("parses a plain float string", () => {
    expect(toFloat("3.14")).toBeCloseTo(3.14);
  });

  it("parses an integer string as float", () => {
    expect(toFloat("42")).toBe(42);
  });

  it("delegates time strings to timeToSeconds", () => {
    expect(toFloat("1:30")).toBe(90);
    expect(toFloat("1:30:00")).toBe(5400);
  });

  it("returns null for empty string", () => {
    expect(toFloat("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(toFloat(undefined)).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(toFloat("abc")).toBeNull();
  });
});
