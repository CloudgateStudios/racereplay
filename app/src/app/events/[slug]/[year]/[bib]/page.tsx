import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatSeconds, netColor, netLabel } from "@/lib/formatting";

export const dynamic = "force-dynamic";
import { Badge } from "@/components/ui/badge";
import { ShareButton } from "@/components/share-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Props {
  params: Promise<{ slug: string; year: string; bib: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug, year, bib } = await params;
  const race = await prisma.race.findUnique({ where: { slug } });
  if (!race) return { title: "Not Found" };
  const event = await prisma.event.findUnique({
    where: { raceId_year: { raceId: race.id, year: parseInt(year, 10) } },
  });
  const athlete = event
    ? await prisma.athlete.findUnique({ where: { eventId_bib: { eventId: event.id, bib } } })
    : null;
  const athleteName = athlete?.name ?? `Bib ${bib}`;
  const rankStr = athlete?.overallRank ? `#${athlete.overallRank} overall` : null;
  const timeStr = athlete?.finishTime ?? null;
  const parts = [rankStr, timeStr].filter(Boolean);
  // Include race + year in the title so the full string hits ~50 chars in SERP
  // e.g. "Jeremy MacLean · IM 70.3 Chattanooga 2026 — Race Replay"
  const title = `${athleteName} · ${race.name} ${year}`;
  const description = `${athleteName} at ${race.name} ${year}${parts.length ? ` — ${parts.join(", ")}` : ""}. See leg-by-leg passing data on Race Replay.`;
  return {
    title,
    description,
    openGraph: { siteName: "Race Replay", title, description },
  };
}

export default async function AthletePage({ params }: Props) {
  const { slug, year: yearStr, bib } = await params;
  const year = parseInt(yearStr, 10);
  if (isNaN(year)) notFound();

  const race = await prisma.race.findUnique({ where: { slug } });
  if (!race) notFound();

  const event = await prisma.event.findUnique({
    where: { raceId_year: { raceId: race.id, year } },
    include: { segments: { orderBy: { displayOrder: "asc" } } },
  });
  if (!event) notFound();

  const athlete = await prisma.athlete.findUnique({
    where: { eventId_bib: { eventId: event.id, bib } },
    include: {
      segments: {
        include: { segment: true },
        orderBy: { segment: { displayOrder: "asc" } },
      },
    },
  });
  if (!athlete) notFound();

  // Multi-year history — find other appearances by this athlete in the same race
  const raceHistory = athlete.normalizedName
    ? await prisma.athlete.findMany({
        where: {
          normalizedName: athlete.normalizedName,
          event: { raceId: race.id, year: { not: year } },
        },
        include: {
          event: { select: { year: true } },
          segments: { select: { net: true } },
        },
        orderBy: { event: { year: "asc" } },
      })
    : [];

  const overallNet = athlete.segments.reduce((sum, s) => sum + (s.net ?? 0), 0);

  // Pre-compute cumulative times in segment display order so we can reference
  // them by index in the render — avoids mutating a variable inside JSX which
  // triggers the react-hooks/immutability lint rule.
  // If any leg time is null the running total resets to null for that row and
  // all subsequent rows, mirroring the chain-break logic in the pipeline.
  const cumulativeTimes: (number | null)[] = [];
  let running: number | null = 0;
  for (const seg of athlete.segments) {
    if (seg.timeSeconds != null && running !== null) {
      running += seg.timeSeconds;
    } else {
      running = null;
    }
    cumulativeTimes.push(running);
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div className="text-muted-foreground mb-1 text-sm">
        <Link href="/" className="hover:text-primary transition-colors">
          All races
        </Link>
        <span className="mx-1">›</span>
        <Link href={`/events/${slug}`} className="hover:text-primary transition-colors">
          {race.name}
        </Link>
        <span className="mx-1">›</span>
        <Link href={`/events/${slug}/${year}`} className="hover:text-primary transition-colors">
          {year}
        </Link>
        <span className="mx-1">›</span>
        <span className="text-foreground">Bib {bib}</span>
      </div>

      {/* Athlete header */}
      <div className="mt-3 mb-8">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-4xl font-bold tracking-tight">{athlete.name}</h1>
          <div className="flex items-center gap-2">
            <Link
              href={`/events/${slug}/${year}/compare?a=${athlete.bib}`}
              className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
            >
              Compare
            </Link>
            <ShareButton />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="secondary">Bib {athlete.bib}</Badge>
          {athlete.division && <Badge variant="secondary">{athlete.division}</Badge>}
          {athlete.gender && <Badge variant="secondary">{athlete.gender}</Badge>}
          {athlete.country && <Badge variant="outline">{athlete.country}</Badge>}
          <Badge variant={athlete.status === "FIN" ? "secondary" : "outline"}>
            {athlete.status}
          </Badge>
        </div>
      </div>

      {/* Rank summary — always render all four cards, show — for missing values */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          {
            label: "Finish Time",
            value: athlete.finishTime ?? null,
          },
          {
            label: "Overall Rank",
            value: athlete.overallRank != null ? `#${athlete.overallRank.toLocaleString()}` : null,
          },
          {
            label: "Gender Rank",
            value: athlete.genderRank != null ? `#${athlete.genderRank.toLocaleString()}` : null,
          },
          {
            label: "Division Rank",
            value:
              athlete.divisionRank != null ? `#${athlete.divisionRank.toLocaleString()}` : null,
          },
        ].map(({ label, value }) => (
          <div key={label} className="bg-card rounded-xl border p-4 shadow-sm">
            <p className="text-muted-foreground text-sm">{label}</p>
            <p
              className={`mt-1 text-2xl font-bold tabular-nums ${value == null ? "text-muted-foreground" : ""}`}
            >
              {value ?? "—"}
            </p>
          </div>
        ))}
      </div>

      {/* Race history — only shown when this athlete has prior/future years */}
      {raceHistory.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">Race History at {race.name}</h2>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Year</TableHead>
                  <TableHead className="text-right">Finish Time</TableHead>
                  <TableHead className="text-right">Overall Rank</TableHead>
                  <TableHead className="text-right">Gender Rank</TableHead>
                  <TableHead className="text-right">Division Rank</TableHead>
                  <TableHead className="text-center">Net Passes</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Current year row */}
                <TableRow className="bg-muted/30 font-medium">
                  <TableCell>
                    {year}{" "}
                    <span className="text-muted-foreground text-xs font-normal">(this race)</span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {athlete.finishTime ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {athlete.overallRank != null ? `#${athlete.overallRank.toLocaleString()}` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {athlete.genderRank != null ? `#${athlete.genderRank.toLocaleString()}` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {athlete.divisionRank != null
                      ? `#${athlete.divisionRank.toLocaleString()}`
                      : "—"}
                  </TableCell>
                  <TableCell
                    className={`text-center font-bold tabular-nums ${netColor(overallNet)}`}
                  >
                    {netLabel(overallNet)}
                  </TableCell>
                  <TableCell />
                </TableRow>
                {/* Other year rows */}
                {raceHistory.map((h) => {
                  const hNet = h.segments.reduce((sum, s) => sum + (s.net ?? 0), 0);
                  return (
                    <TableRow key={h.event.year}>
                      <TableCell>{h.event.year}</TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {h.finishTime ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {h.overallRank != null ? `#${h.overallRank.toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {h.genderRank != null ? `#${h.genderRank.toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {h.divisionRank != null ? `#${h.divisionRank.toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell className={`text-center font-bold tabular-nums ${netColor(hNet)}`}>
                        {netLabel(hNet)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/events/${slug}/${h.event.year}/${h.bib}`}
                          className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors"
                        >
                          View {h.event.year} →
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Passing breakdown */}
      <h2 className="mb-3 text-xl font-semibold">Leg-by-Leg Passing</h2>
      <div className="mb-8 overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Leg</TableHead>
              <TableHead className="text-right">Leg Time</TableHead>
              <TableHead className="text-right">Total Time</TableHead>
              <TableHead className="text-center text-green-600">Passed</TableHead>
              <TableHead className="text-center text-red-500">Got Passed</TableHead>
              <TableHead className="text-center">Net</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {athlete.segments.map((as, i) => (
              <TableRow key={as.segmentId}>
                <TableCell className="font-medium">{as.segment.name}</TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {formatSeconds(as.timeSeconds)}
                </TableCell>
                <TableCell className="text-muted-foreground text-right font-mono text-sm tabular-nums">
                  {cumulativeTimes[i] != null ? formatSeconds(cumulativeTimes[i]) : "—"}
                </TableCell>
                <TableCell className="text-center font-medium text-green-600 tabular-nums">
                  {as.gained != null ? `+${as.gained}` : "—"}
                </TableCell>
                <TableCell className="text-center font-medium text-red-500 tabular-nums">
                  {as.lost != null ? `-${as.lost}` : "—"}
                </TableCell>
                <TableCell className={`text-center font-bold tabular-nums ${netColor(as.net)}`}>
                  {netLabel(as.net)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/30 border-t-2">
              <TableCell className="font-bold">Overall</TableCell>
              <TableCell />
              <TableCell className="text-right font-mono text-sm font-bold tabular-nums">
                {athlete.finishTime ?? "—"}
              </TableCell>
              <TableCell className="text-center font-bold text-green-600 tabular-nums">
                {`+${athlete.segments.reduce((s, a) => s + (a.gained ?? 0), 0)}`}
              </TableCell>
              <TableCell className="text-center font-bold text-red-500 tabular-nums">
                {`-${athlete.segments.reduce((s, a) => s + (a.lost ?? 0), 0)}`}
              </TableCell>
              <TableCell
                className={`text-center text-lg font-bold tabular-nums ${netColor(overallNet)}`}
              >
                {netLabel(overallNet)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <Link
        href={`/events/${slug}/${year}`}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Back to {race.name} {year} results
      </Link>
    </div>
  );
}
