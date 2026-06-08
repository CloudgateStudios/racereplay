import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface Props {
  params: Promise<{ slug: string; year: string; bib: string }>;
}

export default async function Image({ params }: Props) {
  const { slug, year: yearStr, bib } = await params;
  const year = parseInt(yearStr, 10);

  const race = await prisma.race.findUnique({ where: { slug } });
  const event = race
    ? await prisma.event.findUnique({
        where: { raceId_year: { raceId: race.id, year } },
      })
    : null;
  const athlete = event
    ? await prisma.athlete.findUnique({
        where: { eventId_bib: { eventId: event.id, bib } },
      })
    : null;

  const raceName = race?.name ?? "Race Replay";
  const athleteName = athlete?.name ?? bib;
  const finishTime = athlete?.finishTime ?? "—";
  const overallRank = athlete?.overallRank;
  const genderRank = athlete?.genderRank;
  const division = athlete?.division ?? "";
  const divisionRank = athlete?.divisionRank;
  const status = athlete?.status ?? "FIN";
  const isDNF = status !== "FIN";

  return new ImageResponse(
    <div
      style={{
        width: "1200px",
        height: "630px",
        background: "#0f0f0f",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px",
        fontFamily: "sans-serif",
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div
          style={{
            width: "36px",
            height: "36px",
            background: "#f97316",
            borderRadius: "6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{ width: "14px", height: "14px", background: "#0f0f0f", borderRadius: "2px" }}
          />
        </div>
        <span
          style={{
            color: "#f97316",
            fontSize: "22px",
            fontWeight: 900,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Race Replay
        </span>
      </div>

      {/* Athlete name + event */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ color: "#a3a3a3", fontSize: "22px", fontWeight: 600 }}>
          {raceName} · {year} · Bib {bib}
        </div>
        <div
          style={{
            color: "#ffffff",
            fontSize: "72px",
            fontWeight: 900,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
          }}
        >
          {athleteName}
        </div>
        {division && (
          <div style={{ color: "#f97316", fontSize: "22px", fontWeight: 600 }}>{division}</div>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: "48px" }}>
        {!isDNF && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span
              style={{
                color: "#a3a3a3",
                fontSize: "15px",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Finish Time
            </span>
            <span style={{ color: "#ffffff", fontSize: "40px", fontWeight: 800 }}>
              {finishTime}
            </span>
          </div>
        )}
        {overallRank && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span
              style={{
                color: "#a3a3a3",
                fontSize: "15px",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Overall
            </span>
            <span style={{ color: "#f97316", fontSize: "40px", fontWeight: 800 }}>
              #{overallRank}
            </span>
          </div>
        )}
        {genderRank && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span
              style={{
                color: "#a3a3a3",
                fontSize: "15px",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Gender
            </span>
            <span style={{ color: "#ffffff", fontSize: "40px", fontWeight: 800 }}>
              #{genderRank}
            </span>
          </div>
        )}
        {divisionRank && division && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span
              style={{
                color: "#a3a3a3",
                fontSize: "15px",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {division}
            </span>
            <span style={{ color: "#ffffff", fontSize: "40px", fontWeight: 800 }}>
              #{divisionRank}
            </span>
          </div>
        )}
        {isDNF && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span
              style={{
                color: "#a3a3a3",
                fontSize: "15px",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Status
            </span>
            <span style={{ color: "#ef4444", fontSize: "40px", fontWeight: 800 }}>{status}</span>
          </div>
        )}
      </div>
    </div>,
    { width: 1200, height: 630 }
  );
}
