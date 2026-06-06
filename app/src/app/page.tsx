import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
import { Badge } from "@/components/ui/badge";

export default async function HomePage() {
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
        <h1 className="mb-2 text-4xl font-bold tracking-tight">Races</h1>
        <p className="text-muted-foreground text-lg">
          Select a race to explore passing data for every athlete.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {races.map((race) => (
          <Link
            key={race.slug}
            href={`/events/${race.slug}`}
            className="group bg-card hover:border-primary/50 block rounded-xl border p-6 shadow-sm transition-all hover:shadow-md"
          >
            <h2 className="group-hover:text-primary mb-1 text-xl font-semibold transition-colors">
              {race.name}
            </h2>
            <p className="text-muted-foreground mb-4 text-sm">
              {race.events[0]?.type === "TRIATHLON" ? "Triathlon" : "Road Race"}
            </p>
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

      {races.length === 0 && <p className="text-muted-foreground">No races ingested yet.</p>}
    </div>
  );
}
