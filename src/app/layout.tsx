import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'RaceReplay',
    template: '%s | RaceReplay',
  },
  description:
    'Leg-by-leg passing analysis for endurance races. Find out who you passed — and who passed you — in every segment.',
  icons: {
    icon: '/favicon.ico',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
