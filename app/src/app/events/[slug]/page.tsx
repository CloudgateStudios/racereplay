import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const race = await prisma.race.findUnique({ where: { slug } });
  return { title: race ? `${race.name} — RaceTrace` : "Not Found" };
}

export default async function RacePage({ params }: Props) {
  const { slug } = await params;

  const race = await prisma.race.findUnique({
    where: { slug },
    include: {
      events: {
        orderBy: { year: "desc" },
        include: {
          _count: { select: { athletes: true } },
          segments: { orderBy: { displayOrder: "asc" }, select: { name: true } },
        },
      },
    },
  });

  if (!race) notFound();

  return (
    <div>
      <div className="mb-8">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← All races
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">{race.name}</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {race.events.map((event) => (
          <Link
            key={event.year}
            href={`/events/${slug}/${event.year}`}
            className="block rounded-lg border p-5 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start justify-between mb-3">
              <span className="text-2xl font-bold">{event.year}</span>
              <Badge variant="outline">
                {event.type === "TRIATHLON" ? "Triathlon" : "Road Race"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {new Date(event.date).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                {event._count.athletes.toLocaleString()} athletes
              </Badge>
              <Badge variant="secondary">
                {event.segments.map((s) => s.name).join(" · ")}
              </Badge>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
