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
  description: "See who you passed — and who passed you.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <header className="bg-card sticky top-0 z-10 border-b shadow-sm">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
            <span className="text-primary text-xl font-black tracking-tight">⬡</span>
            <Link
              href="/"
              className="hover:text-primary text-lg font-bold tracking-tight transition-colors"
            >
              RaceReplay
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>

        <footer className="bg-card mt-8 border-t">
          <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4">
            <p className="text-muted-foreground text-sm">RaceReplay</p>
            <p className="text-muted-foreground text-xs">v{pkg.version}</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
