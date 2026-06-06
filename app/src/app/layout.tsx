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
        <header className="border-b">
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center">
            <Link href="/" className="font-semibold text-lg tracking-tight">
              RaceTrace
            </Link>
          </div>
        </header>

        <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
          {children}
        </main>

        <footer className="border-t">
          <div className="max-w-6xl mx-auto px-4 h-12 flex items-center">
            <p className="text-sm text-muted-foreground">RaceTrace</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
