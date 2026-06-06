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
  return { title: race ? `${race.name} — RaceReplay` : "Not Found" };
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
          segments: {
            orderBy: { displayOrder: "asc" },
            select: { name: true },
          },
        },
      },
    },
  });

  if (!race) notFound();

  return (
    <div>
      <div className="mb-8">
        <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
          ← All races
        </Link>
        <h1 className="text-4xl font-bold tracking-tight mt-3">{race.name}</h1>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {race.events.map((event) => (
          <Link
            key={event.year}
            href={`/events/${slug}/${event.year}`}
            className="group block rounded-xl border bg-card p-6 shadow-sm hover:shadow-md hover:border-primary/50 transition-all"
          >
            <div className="flex items-start justify-between mb-2">
              <span className="text-3xl font-black group-hover:text-primary transition-colors">
                {event.year}
              </span>
              <Badge variant="outline">
                {event.type === "TRIATHLON" ? "Triathlon" : "Road Race"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
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
