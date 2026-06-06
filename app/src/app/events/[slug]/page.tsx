import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
import { Badge } from "@/components/ui/badge";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const race = await prisma.race.findUnique({ where: { slug } });
  return { title: race ? `${race.name} — Race Replay` : "Not Found" };
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

  // Skip the year-picker when there's only one year of data
  if (race.events.length === 1) {
    redirect(`/events/${slug}/${race.events[0].year}`);
  }

  return (
    <div>
      <div className="mb-8">
        <Link
          href="/races"
          className="text-muted-foreground hover:text-primary text-sm transition-colors"
        >
          ← All races
        </Link>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">{race.name}</h1>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {race.events.map((event) => (
          <Link
            key={event.year}
            href={`/events/${slug}/${event.year}`}
            className="group bg-card hover:border-primary/50 block rounded-xl border p-6 shadow-sm transition-all hover:shadow-md"
          >
            <div className="mb-2 flex items-start justify-between">
              <span className="group-hover:text-primary text-3xl font-black transition-colors">
                {event.year}
              </span>
              <Badge variant="outline">
                {event.type === "TRIATHLON" ? "Triathlon" : "Road Race"}
              </Badge>
            </div>
            <p className="text-muted-foreground mb-4 text-sm">
              {new Date(event.date).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{event._count.athletes.toLocaleString()} athletes</Badge>
              <Badge variant="secondary">{event.segments.map((s) => s.name).join(" · ")}</Badge>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
