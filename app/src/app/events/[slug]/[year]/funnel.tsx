"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface SegmentCount {
  segmentId: number;
  name: string;
  isFinish: boolean;
  count: number;
}

interface Props {
  totalAthletes: number;
  finisherCount: number;
  segmentCounts: SegmentCount[];
}

export function EventFunnel({ totalAthletes, finisherCount, segmentCounts }: Props) {
  const [expanded, setExpanded] = useState(false);

  const finishPct =
    totalAthletes > 0 ? Math.round((finisherCount / totalAthletes) * 100) : 0;

  // Build the full ordered row list for the bar chart
  const rows = [
    { key: "started", label: "Started", count: totalAthletes, isFinish: false },
    ...segmentCounts
      .filter((seg) => !seg.isFinish)
      .map((seg) => ({ key: String(seg.segmentId), label: seg.name, count: seg.count, isFinish: false })),
    { key: "finished", label: "Finished", count: finisherCount, isFinish: true },
  ];

  // Find the segment with the largest absolute drop (excluding "Started" row)
  let maxDropIdx = -1;
  let maxDrop = 0;
  for (let i = 1; i < rows.length; i++) {
    const drop = rows[i - 1].count - rows[i].count;
    if (drop > maxDrop) {
      maxDrop = drop;
      maxDropIdx = i;
    }
  }

  return (
    <div className="mb-6">
      <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
        Participation
      </p>

      {/* ── Mobile: summary pill, expandable ── */}
      <div className="sm:hidden">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="bg-muted/40 flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left"
        >
          <span className="text-sm">
            <span className="font-semibold tabular-nums">
              {totalAthletes.toLocaleString()}
            </span>
            <span className="text-muted-foreground"> started · </span>
            <span className="text-primary font-semibold tabular-nums">
              {finisherCount.toLocaleString()}
            </span>
            <span className="text-muted-foreground"> finished ({finishPct}%)</span>
          </span>
          {expanded ? (
            <ChevronUp className="text-muted-foreground ml-2 h-4 w-4 shrink-0" />
          ) : (
            <ChevronDown className="text-muted-foreground ml-2 h-4 w-4 shrink-0" />
          )}
        </button>

        {expanded && (
          <div className="bg-muted/40 mt-1 rounded-lg border px-4 py-3">
            <div className="divide-border divide-y">
              {rows.map((row, i) => {
                const pct =
                  totalAthletes > 0 ? Math.round((row.count / totalAthletes) * 100) : 0;
                const isBigDrop = i === maxDropIdx;
                return (
                  <div key={row.key} className="flex items-center justify-between py-2">
                    <span className={`text-sm ${isBigDrop ? "text-orange-500 font-medium" : "text-muted-foreground"}`}>
                      {row.label}
                      {isBigDrop && (
                        <span className="ml-1 text-xs">↓ biggest drop</span>
                      )}
                    </span>
                    <span className={`text-sm font-semibold tabular-nums ${row.isFinish ? "text-primary" : ""}`}>
                      {row.count.toLocaleString()}{" "}
                      <span className="text-muted-foreground font-normal">{pct}%</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Desktop: horizontal bar chart ── */}
      <div className="bg-muted/40 hidden rounded-lg border px-6 py-4 sm:block">
        <div className="space-y-2">
          {rows.map((row, i) => {
            const pct =
              totalAthletes > 0 ? Math.round((row.count / totalAthletes) * 100) : 0;
            const barPct = totalAthletes > 0 ? (row.count / totalAthletes) * 100 : 0;
            const isBigDrop = i === maxDropIdx;
            const drop = i > 0 ? rows[i - 1].count - row.count : 0;

            return (
              <div key={row.key} className="flex items-center gap-3">
                {/* Label */}
                <span
                  className={`w-20 shrink-0 text-right text-sm ${
                    isBigDrop
                      ? "font-medium text-orange-500"
                      : row.isFinish
                        ? "text-primary font-medium"
                        : "text-muted-foreground"
                  }`}
                >
                  {row.label}
                </span>

                {/* Bar */}
                <div className="h-6 flex-1 overflow-hidden rounded-sm bg-transparent">
                  <div
                    className={`h-full rounded-sm transition-all ${
                      isBigDrop
                        ? "bg-orange-400/70"
                        : row.isFinish
                          ? "bg-primary/70"
                          : "bg-primary/30"
                    }`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>

                {/* Count + pct */}
                <div className="w-32 shrink-0 text-sm tabular-nums">
                  <span
                    className={`font-semibold ${
                      isBigDrop
                        ? "text-orange-500"
                        : row.isFinish
                          ? "text-primary"
                          : ""
                    }`}
                  >
                    {row.count.toLocaleString()}
                  </span>
                  <span className="text-muted-foreground ml-1">{pct}%</span>
                  {isBigDrop && drop > 0 && (
                    <span className="text-orange-400 ml-2 text-xs">−{drop.toLocaleString()}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
