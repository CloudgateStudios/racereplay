'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatTime } from '@/lib/time-utils'
import type { AthleteSearchResult } from '@/types'

interface AthleteSearchProps {
  raceSlug: string
}

export function AthleteSearch({ raceSlug }: AthleteSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AthleteSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query.trim()) {
      setResults([])
      setHasSearched(false)
      setLoading(false)
      return
    }

    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/races/${encodeURIComponent(raceSlug)}/athletes?q=${encodeURIComponent(query)}&limit=20`
        )
        if (res.ok) {
          const data = await res.json()
          setResults(data.athletes ?? [])
        } else {
          setResults([])
        }
      } catch {
        setResults([])
      } finally {
        setLoading(false)
        setHasSearched(true)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, raceSlug])

  return (
    <div className="space-y-4">
      <Input
        type="search"
        placeholder="Search by name or bib number..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
        className="max-w-md"
      />

      {!query.trim() && (
        <p className="text-sm text-muted-foreground">
          Search for an athlete by name or bib number
        </p>
      )}

      {loading && (
        <div className="space-y-2 max-w-2xl">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!loading && hasSearched && results.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No athletes found for &ldquo;{query}&rdquo;
        </p>
      )}

      {!loading && results.length > 0 && (
        <div className="max-w-2xl overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Bib</TableHead>
                <TableHead>Division</TableHead>
                <TableHead>Finish Time</TableHead>
                <TableHead>Overall Rank</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((athlete) => (
                <TableRow key={athlete.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell>
                    <Link
                      href={`/${raceSlug}/athletes/${athlete.id}`}
                      className="block hover:text-blue-600 font-medium"
                    >
                      {athlete.fullName}
                    </Link>
                  </TableCell>
                  <TableCell>{athlete.bib}</TableCell>
                  <TableCell>{athlete.division}</TableCell>
                  <TableCell>
                    {athlete.result.dns
                      ? 'DNS'
                      : athlete.result.dnf
                        ? 'DNF'
                        : athlete.result.dsq
                          ? 'DSQ'
                          : athlete.result.finishSecs != null
                            ? formatTime(athlete.result.finishSecs)
                            : '—'}
                  </TableCell>
                  <TableCell>
                    {athlete.result.overallRank != null
                      ? `#${athlete.result.overallRank}`
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
