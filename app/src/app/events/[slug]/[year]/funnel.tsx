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

  return (
    <div className="mb-6">
      <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
        Participation
      </p>

      {/* ── Mobile summary pill (collapsed by default) ── */}
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

        {/* Expanded segment breakdown on mobile */}
        {expanded && (
          <div className="bg-muted/40 mt-1 rounded-lg border px-4 py-3">
            <div className="divide-border divide-y">
              {/* Started row */}
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground text-sm">Started</span>
                <span className="text-sm font-semibold tabular-nums">
                  {totalAthletes.toLocaleString()}{" "}
                  <span className="text-muted-foreground font-normal">100%</span>
                </span>
              </div>

              {/* Per-segment rows */}
              {segmentCounts
                .filter((seg) => !seg.isFinish)
                .map((seg) => {
                  const pct =
                    totalAthletes > 0
                      ? Math.round((seg.count / totalAthletes) * 100)
                      : 0;
                  return (
                    <div key={seg.segmentId} className="flex items-center justify-between py-2">
                      <span className="text-muted-foreground text-sm">{seg.name}</span>
                      <span className="text-sm font-semibold tabular-nums">
                        {seg.count.toLocaleString()}{" "}
                        <span className="text-muted-foreground font-normal">{pct}%</span>
                      </span>
                    </div>
                  );
                })}

              {/* Finished row */}
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground text-sm">Finished</span>
                <span className="text-primary text-sm font-semibold tabular-nums">
                  {finisherCount.toLocaleString()}{" "}
                  <span className="text-muted-foreground font-normal">{finishPct}%</span>
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Desktop full horizontal funnel (unchanged) ── */}
      <div className="bg-muted/40 hidden rounded-lg border p-4 sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
        {/* Starters */}
        <div className="flex flex-col items-center px-4 text-center">
          <span className="text-2xl font-bold tabular-nums">
            {totalAthletes.toLocaleString()}
          </span>
          <span className="text-muted-foreground mt-0.5 text-xs">Started</span>
          <span className="text-muted-foreground mt-0.5 text-xs">100%</span>
        </div>

        {segmentCounts
          .filter((seg) => !seg.isFinish)
          .map((seg) => {
            const pct =
              totalAthletes > 0 ? Math.round((seg.count / totalAthletes) * 100) : 0;
            return (
              <div key={seg.segmentId} className="flex flex-row items-center">
                <span className="text-muted-foreground px-1 text-lg select-none">→</span>
                <div className="flex flex-col items-center px-4 text-center">
                  <span className="text-2xl font-bold tabular-nums">
                    {seg.count.toLocaleString()}
                  </span>
                  <span className="text-muted-foreground mt-0.5 text-xs">{seg.name}</span>
                  <span className="text-muted-foreground mt-0.5 text-xs">{pct}%</span>
                </div>
              </div>
            );
          })}

        {/* Finishers */}
        <div className="flex flex-row items-center">
          <span className="text-muted-foreground px-1 text-lg select-none">→</span>
          <div className="flex flex-col items-center px-4 text-center">
            <span className="text-primary text-2xl font-bold tabular-nums">
              {finisherCount.toLocaleString()}
            </span>
            <span className="text-muted-foreground mt-0.5 text-xs">Finished</span>
            <span className="text-muted-foreground mt-0.5 text-xs">{finishPct}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
