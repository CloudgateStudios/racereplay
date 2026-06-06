import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export const dynamic = "force-dynamic";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EventFilters } from "./filters";
import { SortHeader } from "./sort-header";

const PAGE_SIZE = 50;

interface Props {
  params: Promise<{ slug: string; year: string }>;
  searchParams: Promise<Record<string, string>>;
}

const SORTABLE_COLUMNS: Record<string, object> = {
  rank: { overallRank: "asc" as const },
  name: { name: "asc" as const },
  bib: { bib: "asc" as const },
  finish: { finishTime: "asc" as const },
};

export async function generateMetadata({ params }: Props) {
  const { slug, year } = await params;
  const race = await prisma.race.findUnique({ where: { slug } });
  return { title: race ? `${race.name} ${year} — RaceReplay` : "Not Found" };
}

export default async function EventPage({ params, searchParams }: Props) {
  const { slug, year: yearStr } = await params;
  const sp = await searchParams;

  const year = parseInt(yearStr, 10);
  if (isNaN(year)) notFound();

  const q = sp.q?.trim() ?? "";
  const gender = sp.gender ?? "";
  const division = sp.division ?? "";
  const sort = sp.sort ?? "rank";
  const dir = (sp.dir ?? "asc") as "asc" | "desc";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10));

  const race = await prisma.race.findUnique({ where: { slug } });
  if (!race) notFound();

  const event = await prisma.event.findUnique({
    where: { raceId_year: { raceId: race.id, year } },
    include: { segments: { orderBy: { displayOrder: "asc" } } },
  });
  if (!event) notFound();

  // Build where clause
  const where = {
    eventId: event.id,
    ...(q && {
      OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        { bib: { contains: q, mode: "insensitive" as const } },
      ],
    }),
    ...(gender && { gender }),
    ...(division && { division }),
  };

  // Determine sort order
  const orderBy = SORTABLE_COLUMNS[sort] ?? { overallRank: "asc" as const };
  const orderByWithDir = Object.fromEntries(
    Object.entries(orderBy).map(([k]) => [k, dir])
  );

  const [total, athletes, genders, divisions] = await Promise.all([
    prisma.athlete.count({ where }),
    prisma.athlete.findMany({
      where,
      orderBy: orderByWithDir,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        segments: {
          include: { segment: true },
          orderBy: { segment: { displayOrder: "asc" } },
        },
      },
    }),
    prisma.athlete
      .findMany({ where: { eventId: event.id }, distinct: ["gender"], select: { gender: true }, orderBy: { gender: "asc" } })
      .then((r) => r.map((a) => a.gender).filter(Boolean)),
    prisma.athlete
      .findMany({ where: { eventId: event.id }, distinct: ["division"], select: { division: true }, orderBy: { division: "asc" } })
      .then((r) => r.map((a) => a.division).filter(Boolean)),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function pageUrl(p: number) {
    const params = new URLSearchParams(sp);
    params.set("page", String(p));
    return `?${params.toString()}`;
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-1">
        <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
          All races
        </Link>
        <span className="text-sm text-muted-foreground mx-1">›</span>
        <Link href={`/events/${slug}`} className="text-sm text-muted-foreground hover:text-primary transition-colors">
          {race.name}
        </Link>
      </div>

      <h1 className="text-3xl font-bold tracking-tight mb-1">
        {race.name} <span className="text-muted-foreground font-normal">{year}</span>
      </h1>

      <div className="flex flex-wrap gap-2 mb-6">
        <Badge variant="secondary">{event.type === "TRIATHLON" ? "Triathlon" : "Road Race"}</Badge>
        <Badge variant="secondary">{total.toLocaleString()} athletes</Badge>
        <Badge variant="secondary">{event.segments.map((s) => s.name).join(" · ")}</Badge>
      </div>

      <Suspense>
        <EventFilters genders={genders} divisions={divisions} />
      </Suspense>

      {/* Results count */}
      <p className="text-sm text-muted-foreground mb-3">
        {total.toLocaleString()} result{total !== 1 ? "s" : ""}
        {page > 1 ? ` — page ${page} of ${totalPages}` : ""}
      </p>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><SortHeader column="rank" label="Rank" currentSort={sort} currentDir={dir} /></TableHead>
              <TableHead><SortHeader column="bib" label="Bib" currentSort={sort} currentDir={dir} /></TableHead>
              <TableHead><SortHeader column="name" label="Name" currentSort={sort} currentDir={dir} /></TableHead>
              <TableHead>Division</TableHead>
              <TableHead>Status</TableHead>
              <TableHead><SortHeader column="finish" label="Finish" currentSort={sort} currentDir={dir} /></TableHead>
              {event.segments.map((seg) => (
                <>
                  <TableHead key={`${seg.id}-passed`} className="text-center">
                    {seg.name} +
                  </TableHead>
                  <TableHead key={`${seg.id}-lost`} className="text-center">
                    {seg.name} −
                  </TableHead>
                  <TableHead key={`${seg.id}-net`} className="text-center">
                    {seg.name} Net
                  </TableHead>
                </>
              ))}
              <TableHead className="text-center">Overall Net</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {athletes.map((athlete) => {
              const overallNet = athlete.segments.reduce(
                (sum, s) => sum + (s.net ?? 0),
                0
              );
              return (
                <TableRow key={athlete.id} className="hover:bg-muted/50">
                  <TableCell className="tabular-nums">{athlete.overallRank ?? "—"}</TableCell>
                  <TableCell className="tabular-nums font-mono text-sm">{athlete.bib}</TableCell>
                  <TableCell>
                    <Link
                      href={`/events/${slug}/${year}/${athlete.bib}`}
                      className="hover:underline font-medium"
                    >
                      {athlete.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{athlete.division || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={athlete.status === "FIN" ? "secondary" : "outline"}>
                      {athlete.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums font-mono text-sm">{athlete.finishTime || "—"}</TableCell>
                  {event.segments.map((seg) => {
                    const s = athlete.segments.find((as) => as.segmentId === seg.id);
                    return (
                      <>
                        <TableCell key={`${athlete.id}-${seg.id}-g`} className="text-center tabular-nums text-green-600">
                          {s?.gained != null ? `+${s.gained}` : "—"}
                        </TableCell>
                        <TableCell key={`${athlete.id}-${seg.id}-l`} className="text-center tabular-nums text-red-500">
                          {s?.lost != null ? `-${s.lost}` : "—"}
                        </TableCell>
                        <TableCell key={`${athlete.id}-${seg.id}-n`} className={`text-center tabular-nums font-medium ${(s?.net ?? 0) > 0 ? "text-green-600" : (s?.net ?? 0) < 0 ? "text-red-500" : ""}`}>
                          {s?.net != null ? (s.net > 0 ? `+${s.net}` : s.net) : "—"}
                        </TableCell>
                      </>
                    );
                  })}
                  <TableCell className={`text-center tabular-nums font-bold ${overallNet > 0 ? "text-green-600" : overallNet < 0 ? "text-red-500" : ""}`}>
                    {overallNet > 0 ? `+${overallNet}` : overallNet}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 mt-4">
          {page > 1 && (
            <Link href={pageUrl(page - 1)} className="text-sm px-3 py-1 rounded border hover:bg-muted">
              ← Prev
            </Link>
          )}
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={pageUrl(page + 1)} className="text-sm px-3 py-1 rounded border hover:bg-muted">
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
