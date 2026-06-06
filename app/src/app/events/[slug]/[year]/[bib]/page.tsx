import Link from "next/link";
import { notFound } from "next/navigation";
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

interface Props {
  params: Promise<{ slug: string; year: string; bib: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug, year, bib } = await params;
  const race = await prisma.race.findUnique({ where: { slug } });
  return { title: race ? `Bib ${bib} — ${race.name} ${year} — RaceTrace` : "Not Found" };
}

function formatSeconds(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function netColor(net: number | null) {
  if (net == null || net === 0) return "";
  return net > 0 ? "text-green-600" : "text-red-500";
}

function netLabel(net: number | null) {
  if (net == null) return "—";
  if (net > 0) return `+${net}`;
  return String(net);
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

  const overallNet = athlete.segments.reduce((sum, s) => sum + (s.net ?? 0), 0);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-1 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">All races</Link>
        <span className="mx-1">›</span>
        <Link href={`/events/${slug}`} className="hover:text-foreground">{race.name}</Link>
        <span className="mx-1">›</span>
        <Link href={`/events/${slug}/${year}`} className="hover:text-foreground">{year}</Link>
        <span className="mx-1">›</span>
        <span className="text-foreground">Bib {bib}</span>
      </div>

      {/* Athlete header */}
      <div className="mt-3 mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{athlete.name}</h1>
        <div className="flex flex-wrap gap-2 mt-3">
          <Badge variant="secondary">Bib {athlete.bib}</Badge>
          {athlete.division && <Badge variant="secondary">{athlete.division}</Badge>}
          {athlete.gender && <Badge variant="secondary">{athlete.gender}</Badge>}
          {athlete.country && <Badge variant="outline">{athlete.country}</Badge>}
          <Badge variant={athlete.status === "FIN" ? "secondary" : "outline"}>
            {athlete.status}
          </Badge>
        </div>
      </div>

      {/* Rank summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Finish Time", value: athlete.finishTime || "—" },
          { label: "Overall Rank", value: athlete.overallRank != null ? `#${athlete.overallRank.toLocaleString()}` : "—" },
          { label: "Gender Rank", value: athlete.genderRank != null ? `#${athlete.genderRank.toLocaleString()}` : "—" },
          { label: "Division Rank", value: athlete.divisionRank != null ? `#${athlete.divisionRank.toLocaleString()}` : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Passing breakdown */}
      <h2 className="text-xl font-semibold mb-3">Leg-by-Leg Passing</h2>
      <div className="rounded-md border overflow-x-auto mb-8">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Leg</TableHead>
              <TableHead className="text-right">Time</TableHead>
              <TableHead className="text-center text-green-600">Passed</TableHead>
              <TableHead className="text-center text-red-500">Got Passed</TableHead>
              <TableHead className="text-center">Net</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {athlete.segments.map((as) => (
              <TableRow key={as.segmentId}>
                <TableCell className="font-medium">{as.segment.name}</TableCell>
                <TableCell className="text-right tabular-nums font-mono text-sm">
                  {formatSeconds(as.timeSeconds)}
                </TableCell>
                <TableCell className="text-center tabular-nums text-green-600 font-medium">
                  {as.gained != null ? `+${as.gained}` : "—"}
                </TableCell>
                <TableCell className="text-center tabular-nums text-red-500 font-medium">
                  {as.lost != null ? `-${as.lost}` : "—"}
                </TableCell>
                <TableCell className={`text-center tabular-nums font-bold ${netColor(as.net)}`}>
                  {netLabel(as.net)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2 bg-muted/30">
              <TableCell className="font-bold">Overall</TableCell>
              <TableCell className="text-right tabular-nums font-mono text-sm font-bold">
                {athlete.finishTime || "—"}
              </TableCell>
              <TableCell className="text-center tabular-nums text-green-600 font-bold">
                {`+${athlete.segments.reduce((s, a) => s + (a.gained ?? 0), 0)}`}
              </TableCell>
              <TableCell className="text-center tabular-nums text-red-500 font-bold">
                {`-${athlete.segments.reduce((s, a) => s + (a.lost ?? 0), 0)}`}
              </TableCell>
              <TableCell className={`text-center tabular-nums font-bold text-lg ${netColor(overallNet)}`}>
                {netLabel(overallNet)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <Link
        href={`/events/${slug}/${year}`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to {race.name} {year} results
      </Link>
    </div>
  );
}
