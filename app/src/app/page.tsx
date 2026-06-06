import Link from "next/link";
import { prisma } from "@/lib/prisma";
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
        <h1 className="text-4xl font-bold tracking-tight mb-2">Races</h1>
        <p className="text-muted-foreground text-lg">
          Select a race to explore passing data for every athlete.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {races.map((race) => (
          <Link
            key={race.slug}
            href={`/events/${race.slug}`}
            className="group block rounded-xl border bg-card p-6 shadow-sm hover:shadow-md hover:border-primary/50 transition-all"
          >
            <h2 className="font-semibold text-xl mb-1 group-hover:text-primary transition-colors">
              {race.name}
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
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

      {races.length === 0 && (
        <p className="text-muted-foreground">No races ingested yet.</p>
      )}
    </div>
  );
}
