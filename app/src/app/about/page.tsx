import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About — Race Replay",
  description: "Why Race Replay was built and who made it.",
};

export default function AboutPage() {
  return (
    <div className="max-w-5xl">
      {/* ── Title row: full width ── */}
      <h1 className="mb-3 text-4xl font-black tracking-tight uppercase">About Race Replay</h1>
      <p className="text-muted-foreground mb-12 text-lg leading-relaxed">
        Why this exists and how it came to be.
      </p>

      {/* ── Content row: 2/3 text + 1/3 image ── */}
      <div className="flex flex-col gap-10 sm:flex-row sm:items-center">
        {/* Left: sections (below image on mobile) */}
        <div className="order-2 w-full space-y-14 sm:order-1 sm:w-2/3">
          <section>
            <h2 className="mb-5 text-xl font-bold tracking-tight">The problem</h2>
            <div className="space-y-4">
              <p className="text-muted-foreground leading-relaxed">
                Race results pages show you your chip time and your overall rank, but they
                don&apos;t tell you what actually happened on course. When everyone starts at a
                different time, finishing rank doesn&apos;t reflect the physical experience of
                racing.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Did you pass 50 people on the bike leg of a triathlon? Did someone come flying past
                you in the last 5k? Standard results have no answer. Race Replay does.
              </p>
            </div>
          </section>

          <section>
            <h2 className="mb-5 text-xl font-bold tracking-tight">How it works</h2>
            <div className="space-y-4">
              <p className="text-muted-foreground leading-relaxed">
                By anchoring each athlete&apos;s split times to their personal start time, we
                compute an absolute clock position at every timing checkpoint. Comparing those
                positions leg-by-leg reveals every physical pass — who moved forward, who got
                caught, and by how much.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                The algorithm self-checks: every pass gained by one athlete must correspond to a
                pass conceded by another. If the totals don&apos;t balance, something is wrong with
                the data and we surface that rather than show you misleading numbers.
              </p>
            </div>
          </section>

          <section>
            <h2 className="mb-5 text-xl font-bold tracking-tight">Why this data matters</h2>
            <div className="space-y-4">
              <p className="text-muted-foreground leading-relaxed">
                Chip time tells you the outcome. Passing tells you the mechanism. Two athletes can
                cross the line at the same time having had completely opposite race experiences —
                one ran down 150 people on the run leg, the other gave back every spot they gained
                on the bike.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                It also cuts through noise that time can&apos;t. A slower finish time year-over-year
                might reflect heat, a tougher field, or a bad day — but if your passing numbers
                improved, you got stronger. Race Replay gives you the signal beneath the clock.
              </p>
            </div>
          </section>

          <section>
            <h2 className="mb-5 text-xl font-bold tracking-tight">Built for coaches too</h2>
            <div className="space-y-4">
              <p className="text-muted-foreground leading-relaxed">
                Coaches already know what to prescribe. Race Replay gives them race-day evidence to
                validate or challenge it. Instead of debriefing on splits alone, you can see exactly
                where an athlete moved through the field and where they lost ground — leg by leg,
                relative to everyone else on course that day.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                If you coach multiple athletes in the same race, you can compare their patterns side
                by side: who&apos;s a strong swimmer getting caught on the bike, who blows up on the
                run, who races consistently well but starts too conservatively. Passing data
                surfaces those tendencies in a way split times alone never could.
              </p>
            </div>
          </section>

          <section>
            <h2 className="mb-5 text-xl font-bold tracking-tight">Who built this</h2>
            <div className="space-y-4">
              <p className="text-muted-foreground leading-relaxed">
                Race Replay is a project by{" "}
                <Link
                  href="https://cloudgatestudios.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80 inline-flex items-center gap-1 font-medium transition-colors"
                >
                  Cloudgate Studios
                </Link>
                . It started as a personal tool to make sense of triathlon results, and grew into
                something worth sharing with the broader racing community.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                The project is open source. If you want to see how it works under the hood, report a
                bug, or add support for a new race series, the code is on GitHub.
              </p>
            </div>
          </section>

          <div className="flex flex-wrap gap-4">
            <Link
              href="https://github.com/CloudgateStudios/race_replay"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-card hover:border-primary/50 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium shadow-sm transition-all hover:shadow-md"
            >
              <svg
                viewBox="0 0 24 24"
                className="text-primary h-4 w-4"
                fill="currentColor"
                aria-hidden
              >
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              View on GitHub
            </Link>
          </div>
        </div>

        {/* Right: photo */}
        <div className="order-1 w-full shrink-0 sm:order-2 sm:w-1/3">
          <Image
            src="/arra-chi13.1.jpeg"
            alt="Tom Arra racing at Chicago 13.1"
            width={400}
            height={600}
            className="w-full rounded-xl object-cover object-top shadow-md"
            priority
          />
        </div>
      </div>
    </div>
  );
}
