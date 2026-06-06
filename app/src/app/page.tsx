import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";

export default async function HomePage() {
  const races = await prisma.race.findMany({
    include: {
      events: {
        orderBy: { year: "desc" },
        select: { year: true, type: true, date: true, _count: { select: { athletes: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight mb-2">Races</h1>
      <p className="text-muted-foreground mb-8">
        Select a race to see passing data for every athlete.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {races.map((race) => (
          <Link
            key={race.slug}
            href={`/events/${race.slug}`}
            className="block rounded-lg border p-5 hover:bg-muted/50 transition-colors"
          >
            <h2 className="font-semibold text-lg mb-3">{race.name}</h2>
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
