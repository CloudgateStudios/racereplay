import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface Props {
  params: Promise<{ slug: string; year: string }>;
}

export default async function Image({ params }: Props) {
  const { slug, year: yearStr } = await params;
  const year = parseInt(yearStr, 10);

  const race = await prisma.race.findUnique({ where: { slug } });
  const event = race
    ? await prisma.event.findUnique({
        where: { raceId_year: { raceId: race.id, year } },
      })
    : null;

  const totalAthletes = event ? await prisma.athlete.count({ where: { eventId: event.id } }) : 0;
  const finisherCount = event
    ? await prisma.athlete.count({ where: { eventId: event.id, status: "FIN" } })
    : 0;

  const finishPct = totalAthletes > 0 ? ((finisherCount / totalAthletes) * 100).toFixed(1) : "0.0";

  const raceName = race?.name ?? "Race Replay";
  const eventDate = event
    ? new Date(event.date).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

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
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <svg width="44" height="44" viewBox="0 0 28 28">
          <polygon points="26,14 20,24 8,24 2,14 8,4 20,4" fill="#f97316" />
          <polygon points="11,9 11,19 20,14" fill="white" />
        </svg>
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

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div
          style={{
            color: "#f97316",
            fontSize: "20px",
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {eventDate}
        </div>
        <div
          style={{
            color: "#ffffff",
            fontSize: "72px",
            fontWeight: 900,
            lineHeight: "1.05",
            letterSpacing: "-0.02em",
          }}
        >
          {raceName}
        </div>
        <div style={{ color: "#a3a3a3", fontSize: "36px", fontWeight: 700 }}>{yearStr}</div>
      </div>

      <div style={{ display: "flex", gap: "48px" }}>
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
            Athletes
          </span>
          <span style={{ color: "#ffffff", fontSize: "40px", fontWeight: 800 }}>
            {totalAthletes.toLocaleString()}
          </span>
        </div>
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
            Finishers
          </span>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
            <span style={{ color: "#f97316", fontSize: "40px", fontWeight: 800 }}>
              {finisherCount.toLocaleString()}
            </span>
            <span style={{ color: "#a3a3a3", fontSize: "24px", fontWeight: 500 }}>
              {`${finishPct}%`}
            </span>
          </div>
        </div>
      </div>
    </div>,
    { width: 1200, height: 630 }
  );
}
