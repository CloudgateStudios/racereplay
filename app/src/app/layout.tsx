import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  title: "RaceTrace",
  description: "See who you passed — and who passed you.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b bg-card shadow-sm sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-2">
            <span className="text-primary font-black text-xl tracking-tight">⬡</span>
            <Link
              href="/"
              className="font-bold text-lg tracking-tight hover:text-primary transition-colors"
            >
              RaceTrace
            </Link>
          </div>
        </header>

        <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
          {children}
        </main>

        <footer className="border-t bg-card mt-8">
          <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">RaceTrace</p>
            <p className="text-xs text-muted-foreground">See who you passed — and who passed you.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
