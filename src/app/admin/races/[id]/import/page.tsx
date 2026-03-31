'use client'

import { useState, useEffect, use } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

type ImportSummary = {
  athletesImported: number
  finishers: number
  dnfCount: number
  dnsCount: number
  passingMode: string
  invariantCheck: Record<string, boolean>
  durationMs: number
  raceSlug?: string
}

type RaceInfo = {
  id: string
  name: string
  slug: string
  distance: string
  date: string
}

export default function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [race, setRace] = useState<RaceInfo | null>(null)
  const [raceError, setRaceError] = useState<string | null>(null)

  // RTRT import form state
  const [rtrtEventId, setRtrtEventId] = useState('')
  const [competitorUrl, setCompetitorUrl] = useState('')
  const [clearExisting, setClearExisting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState('')

  // CSV upload form state
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [hasWaveData, setHasWaveData] = useState(false)
  const [csvClearExisting, setCsvClearExisting] = useState(false)
  const [csvConfirmDelete, setCsvConfirmDelete] = useState('')
  const [showCsvSection, setShowCsvSection] = useState(false)

  // Shared state
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [result, setResult] = useState<ImportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/admin/races/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.race) setRace(data.race)
        else setRaceError(data.error ?? 'Race not found')
      })
      .catch(() => setRaceError('Failed to load race'))
  }, [id])

  const isRtrtImportEnabled =
    rtrtEventId.trim() &&
    !loading &&
    (!clearExisting || confirmDelete === 'CONFIRM_DELETE')

  const isCsvImportEnabled =
    csvFile !== null &&
    !loading &&
    (!csvClearExisting || csvConfirmDelete === 'CONFIRM_DELETE')

  async function handleRtrtImport(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setResult(null)
    setLoading(true)
    setLoadingMessage(
      'Fetching race data from RTRT.me — this takes around 5 minutes for a large race'
    )

    try {
      const body: Record<string, unknown> = {
        raceId: id,
        rtrtEventId: rtrtEventId.trim(),
      }
      if (competitorUrl.trim()) body.competitorUrl = competitorUrl.trim()
      if (clearExisting && confirmDelete === 'CONFIRM_DELETE') {
        body.clearExisting = 'CONFIRM_DELETE'
      }

      const res = await fetch('/api/admin/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (res.ok) {
        setResult({ ...data, raceSlug: race?.slug })
      } else {
        setError(data.error ?? 'Import failed')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
      setLoadingMessage('')
    }
  }

  async function handleCsvUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!csvFile) return

    setError(null)
    setResult(null)
    setLoading(true)
    setLoadingMessage('Processing CSV...')

    try {
      const formData = new FormData()
      formData.append('raceId', id)
      formData.append('file', csvFile)
      formData.append('hasWaveData', String(hasWaveData))
      if (csvClearExisting && csvConfirmDelete === 'CONFIRM_DELETE') {
        formData.append('clearExisting', 'CONFIRM_DELETE')
      }

      const res = await fetch('/api/admin/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (res.ok) {
        setResult({ ...data, raceSlug: race?.slug })
      } else {
        setError(data.error ?? 'Upload failed')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
      setLoadingMessage('')
    }
  }

  function handleImportAgain() {
    setResult(null)
    setError(null)
    setClearExisting(false)
    setConfirmDelete('')
  }

  if (raceError) {
    return (
      <div className="min-h-screen p-8">
        <p className="text-destructive">{raceError}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <Link href="/admin" className="text-muted-foreground hover:text-foreground text-sm">
            ← Back to admin
          </Link>
        </div>

        {race && (
          <div className="mb-6">
            <h1 className="text-2xl font-bold">{race.name}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {race.distance} &bull; {String(race.date).slice(0, 10)}
            </p>
          </div>
        )}

        {/* Success result */}
        {result && (
          <Card className="mb-6 border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="text-green-800">Import Complete</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <strong>Athletes imported:</strong> {result.athletesImported}
              </p>
              <p>
                <strong>Finishers:</strong> {result.finishers}
              </p>
              <p>
                <strong>DNF:</strong> {result.dnfCount}
              </p>
              {result.dnsCount != null && (
                <p>
                  <strong>DNS:</strong> {result.dnsCount}
                </p>
              )}
              <p>
                <strong>Passing mode:</strong> {result.passingMode}
              </p>
              {result.invariantCheck && (
                <div>
                  <strong>Invariant check:</strong>
                  <ul className="ml-4 mt-1">
                    {Object.entries(result.invariantCheck).map(([leg, ok]) => (
                      <li key={leg} className={ok ? 'text-green-700' : 'text-red-700'}>
                        {leg}: {ok ? 'pass' : 'FAIL'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p>
                <strong>Duration:</strong> {(result.durationMs / 1000).toFixed(1)}s
              </p>
              <div className="flex gap-3 pt-2">
                {result.raceSlug && (
                  <a
                    href={`/${result.raceSlug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button size="sm" variant="outline">
                      View race
                    </Button>
                  </a>
                )}
                <Button size="sm" variant="ghost" onClick={handleImportAgain}>
                  Import again
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Primary: RTRT import */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Import from RTRT.me</CardTitle>
            <CardDescription>
              Fetch live timing data directly from RTRT.me. Takes ~5 minutes for a large
              race.{' '}
              <a
                href="https://track.rtrt.me"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Find event ID at track.rtrt.me
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRtrtImport} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="rtrtEventId">
                  RTRT Event ID
                </label>
                <Input
                  id="rtrtEventId"
                  value={rtrtEventId}
                  onChange={(e) => setRtrtEventId(e.target.value)}
                  placeholder="IRM-OCEANSIDE703-2026"
                  disabled={loading}
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="competitorUrl">
                  competitor.com URL (optional)
                </label>
                <Input
                  id="competitorUrl"
                  value={competitorUrl}
                  onChange={(e) => setCompetitorUrl(e.target.value)}
                  placeholder="https://labs-v2.competitor.com/..."
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">
                  Must be a labs-v2.competitor.com URL. Provides official chip times.
                </p>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={clearExisting}
                    onChange={(e) => {
                      setClearExisting(e.target.checked)
                      if (!e.target.checked) setConfirmDelete('')
                    }}
                    disabled={loading}
                  />
                  Clear existing data before import
                </label>
                {clearExisting && (
                  <div className="space-y-1">
                    <p className="text-xs text-destructive">
                      This will permanently delete all existing athletes and results for this
                      race. Type{' '}
                      <span className="font-mono font-bold">CONFIRM_DELETE</span> to confirm.
                    </p>
                    <Input
                      value={confirmDelete}
                      onChange={(e) => setConfirmDelete(e.target.value)}
                      placeholder="CONFIRM_DELETE"
                      disabled={loading}
                    />
                  </div>
                )}
              </div>

              {error && !loading && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}

              {loading && loadingMessage && (
                <p className="text-sm text-muted-foreground">{loadingMessage}</p>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={!isRtrtImportEnabled}
              >
                {loading ? 'Importing...' : 'Import from RTRT.me'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Secondary: CSV upload */}
        <div>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground underline"
            onClick={() => setShowCsvSection((v) => !v)}
          >
            {showCsvSection ? 'Hide' : 'Show'} CSV upload
          </button>

          {showCsvSection && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>CSV Upload</CardTitle>
                <CardDescription>
                  Upload a pre-built CSV from the POC scripts or another source.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCsvUpload} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="csvFile">
                      CSV File
                    </label>
                    <Input
                      id="csvFile"
                      type="file"
                      accept=".csv"
                      onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
                      disabled={loading}
                      required
                    />
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={hasWaveData}
                      onChange={(e) => setHasWaveData(e.target.checked)}
                      disabled={loading}
                    />
                    CSV includes Wave Offset (Seconds) column
                  </label>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={csvClearExisting}
                        onChange={(e) => {
                          setCsvClearExisting(e.target.checked)
                          if (!e.target.checked) setCsvConfirmDelete('')
                        }}
                        disabled={loading}
                      />
                      Clear existing data before import
                    </label>
                    {csvClearExisting && (
                      <div className="space-y-1">
                        <p className="text-xs text-destructive">
                          Type{' '}
                          <span className="font-mono font-bold">CONFIRM_DELETE</span> to
                          confirm.
                        </p>
                        <Input
                          value={csvConfirmDelete}
                          onChange={(e) => setCsvConfirmDelete(e.target.value)}
                          placeholder="CONFIRM_DELETE"
                          disabled={loading}
                        />
                      </div>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    variant="outline"
                    disabled={!isCsvImportEnabled}
                  >
                    {loading ? 'Uploading...' : 'Upload CSV'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
