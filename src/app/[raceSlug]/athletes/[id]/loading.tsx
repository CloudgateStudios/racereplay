import { Skeleton } from '@/components/ui/skeleton'

export default function AthletePageLoading() {
  return (
    <div className="min-h-screen p-8 max-w-4xl mx-auto space-y-6">
      {/* Back link skeleton */}
      <Skeleton className="h-4 w-24" />

      {/* Athlete header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-56" />
      </div>

      {/* Summary strip */}
      <Skeleton className="h-16 w-full rounded-lg" />

      {/* Leg cards */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ))}
    </div>
  )
}
