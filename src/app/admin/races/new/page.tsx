'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}

export default function NewRacePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [date, setDate] = useState('')
  const [location, setLocation] = useState('')
  const [distance, setDistance] = useState<'FULL' | 'HALF'>('HALF')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleNameChange(val: string) {
    setName(val)
    if (!slugEdited) {
      setSlug(slugify(val))
    }
  }

  function handleSlugChange(val: string) {
    setSlug(val)
    setSlugEdited(true)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/admin/races', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, date, location, distance }),
      })

      const data = await res.json()

      if (res.ok) {
        router.push(`/admin/races/${data.race.id}/import`)
        return
      }

      setError(data.error ?? 'An error occurred.')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-lg mx-auto">
        <div className="mb-6">
          <Link href="/admin" className="text-muted-foreground hover:text-foreground text-sm">
            ← Back to admin
          </Link>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>New Race</CardTitle>
            <CardDescription>Create a race record before importing results.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="name">
                  Race Name
                </label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="IRONMAN 70.3 Oceanside 2026"
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="slug">
                  Slug (URL identifier)
                </label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder="oceanside703-2026"
                  pattern="[a-z0-9-]+"
                  title="Lowercase letters, numbers, and hyphens only"
                  required
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">
                  This becomes the URL: /
                  <span className="font-mono">{slug || 'your-slug'}</span>
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="date">
                  Race Date
                </label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="location">
                  Location
                </label>
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Oceanside, California"
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="distance">
                  Distance
                </label>
                <select
                  id="distance"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value as 'FULL' | 'HALF')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={loading}
                >
                  <option value="HALF">HALF (70.3)</option>
                  <option value="FULL">FULL (140.6)</option>
                </select>
              </div>

              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Creating race...' : 'Create Race'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
