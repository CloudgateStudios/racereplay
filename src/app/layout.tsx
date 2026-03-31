import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'RaceReplay',
  description: 'Leg-by-leg passing analysis for endurance races',
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
