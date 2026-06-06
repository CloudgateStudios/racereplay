import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import pkg from "../../package.json";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="bg-background text-foreground flex min-h-full flex-col">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="bg-card/80 sticky top-0 z-10 border-b backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
            {/* Logo */}
            <Link
              href="/"
              className="hover:text-primary flex items-center gap-2 font-bold tracking-tight transition-colors"
            >
              <span className="text-primary text-xl font-black">⬡</span>
              <span className="text-base">RaceReplay</span>
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
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">{children}</main>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="bg-card border-t">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
            <p className="text-muted-foreground text-sm">© {new Date().getFullYear()} RaceReplay</p>
            <p className="text-muted-foreground font-mono text-xs">v{pkg.version}</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
