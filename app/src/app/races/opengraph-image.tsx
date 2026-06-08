import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { loadOgFonts } from "@/lib/og-fonts";
import { OgCard } from "@/lib/og-card";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const [raceCount, athleteAgg] = await Promise.all([
    prisma.race.count(),
    prisma.athlete.aggregate({ _count: { id: true } }),
  ]);

  const totalAthletes = athleteAgg._count.id;
  const fonts = await loadOgFonts();

  return new ImageResponse(
    <OgCard
      eyebrow="Race Database"
      title="All Races"
      stats={[
        { label: "Races", value: raceCount.toLocaleString() },
        { label: "Total Athletes", value: totalAthletes.toLocaleString(), color: "#f97316" },
      ]}
    />,
    { width: 1200, height: 630, fonts }
  );
}
