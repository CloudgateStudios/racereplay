import Link from 'next/link'

export default function RaceNotFound() {
  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto flex flex-col items-center justify-center">
      <h1 className="text-2xl font-bold mb-2">Race not found</h1>
      <p className="text-muted-foreground mb-6">
        The race you&apos;re looking for doesn&apos;t exist or has been removed.
      </p>
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back to all races
      </Link>
    </main>
  )
}
