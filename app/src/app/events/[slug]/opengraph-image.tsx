import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { loadOgFonts } from "@/lib/og-fonts";
import { OgCard } from "@/lib/og-card";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function Image({ params }: Props) {
  const { slug } = await params;

  const race = await prisma.race.findUnique({
    where: { slug },
    include: {
      events: {
        orderBy: { year: "desc" },
        include: { _count: { select: { athletes: true } } },
      },
    },
  });

  const raceName = race?.name ?? "Race Replay";
  const raceType = race?.events[0]?.type === "TRIATHLON" ? "Triathlon" : "Road Race";
  const totalAthletes = race?.events.reduce((sum, e) => sum + e._count.athletes, 0) ?? 0;
  const yearCount = race?.events.length ?? 0;
  const fonts = await loadOgFonts();

  const editionPills = (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span
        style={{
          color: "#a3a3a3",
          fontSize: "15px",
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        Editions
      </span>
      <div style={{ display: "flex", gap: "10px" }}>
        {(race?.events ?? []).map((e) => (
          <div
            key={e.year}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "2px",
              background: "#1f1f1f",
              border: "1px solid #333",
              borderRadius: "8px",
              padding: "8px 16px",
            }}
          >
            <span style={{ color: "#ffffff", fontSize: "20px", fontWeight: 700 }}>
              {String(e.year)}
            </span>
            <span style={{ color: "#a3a3a3", fontSize: "13px", fontWeight: 500 }}>
              {e._count.athletes.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return new ImageResponse(
    <OgCard
      eyebrow={raceType}
      title={raceName}
      stats={[
        { label: "Years of data", value: String(yearCount) },
        { label: "Total athletes", value: totalAthletes.toLocaleString(), color: "#f97316" },
      ]}
      bottomSlot={editionPills}
    />,
    { width: 1200, height: 630, fonts }
  );
}
