import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { RaceTypeIcon } from "@/components/race-type-icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "All Races",
  description:
    "Browse every race tracked by Race Replay — leg-by-leg passing data for triathlons and road races.",
  openGraph: {
    siteName: "Race Replay",
    title: "All Races — Race Replay",
    description: "Browse every race tracked by Race Replay.",
  },
};

export default async function RacesPage() {
  const races = await prisma.race.findMany({
    include: {
      events: {
        orderBy: { year: "desc" },
        select: {
          year: true,
          type: true,
          date: true,
          _count: { select: { athletes: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <div className="mb-10">
        <h1 className="mb-2 text-4xl font-black tracking-tight">All Races</h1>
        <p className="text-muted-foreground text-lg">
          Browse every race in the Race Replay database.
        </p>
      </div>

      {races.length === 0 ? (
        <p className="text-muted-foreground">No races ingested yet.</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {races.map((race) => (
            <Link
              key={race.slug}
              href={`/events/${race.slug}`}
              className="group bg-card hover:border-primary/50 block rounded-xl border p-6 shadow-sm transition-all hover:shadow-md"
            >
              <div className="mb-4 flex items-start gap-3">
                <RaceTypeIcon type={race.events[0]?.type ?? "ROAD_RACE"} />
                <div className="min-w-0">
                  <h2 className="group-hover:text-primary text-lg leading-snug font-semibold transition-colors">
                    {race.name}
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    {race.events[0]?.type === "TRIATHLON" ? "Triathlon" : "Road Race"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {race.events.map((event) => (
                  <Badge key={event.year} variant="secondary">
                    {event.year} · {event._count.athletes.toLocaleString()} athletes
                  </Badge>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
