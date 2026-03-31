import { Skeleton } from '@/components/ui/skeleton'

export default function RacePageLoading() {
  return (
    <div className="max-w-4xl mx-auto p-8 space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-10 w-full mt-6" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}
