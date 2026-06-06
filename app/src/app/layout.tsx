import type { Metadata } from "next";
import { Barlow, Barlow_Condensed, Geist_Mono } from "next/font/google";
import Link from "next/link";
import pkg from "../../package.json";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RaceReplay",
  description: "See who you passed — and who passed you, leg by leg.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowCondensed.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="bg-card/80 sticky top-0 z-10 border-b backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6 sm:px-10 lg:px-16">
            {/* Logo */}
            <Link
              href="/"
              className="hover:text-primary flex items-center gap-1.5 transition-colors"
              style={{ fontFamily: "var(--font-barlow-condensed), sans-serif" }}
            >
              <span className="text-primary text-2xl leading-none font-black">⬡</span>
              <span className="text-lg font-black tracking-wide uppercase">Race Replay</span>
            </Link>

            {/* Nav */}
            <nav className="flex items-center gap-6">
              <Link
                href="/races"
                className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
              >
                Races
              </Link>
            </nav>
          </div>
        </header>

        {/* ── Page content ────────────────────────────────────────────────── */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 sm:px-10 lg:px-16 xl:px-20">
          {children}
        </main>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="bg-card border-t">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6 sm:px-10 lg:px-16">
            <p className="text-muted-foreground text-sm">© {new Date().getFullYear()} RaceReplay</p>
            <p className="text-muted-foreground font-mono text-xs">v{pkg.version}</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
