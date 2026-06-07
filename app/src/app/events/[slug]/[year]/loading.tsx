export default function EventLoading() {
  return (
    <div className="animate-pulse">
      {/* Page header skeleton */}
      <div className="mb-2 h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="mb-2 h-9 w-72 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="mb-8 h-4 w-48 rounded bg-gray-200 dark:bg-gray-700" />

      {/* Funnel skeleton */}
      <div className="mb-8 flex gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-6 w-24 rounded-full bg-gray-200 dark:bg-gray-700" />
        ))}
      </div>

      {/* Filter bar skeleton */}
      <div className="mb-6 flex gap-3">
        <div className="h-9 w-48 rounded-lg bg-gray-200 dark:bg-gray-700" />
        <div className="h-9 w-32 rounded-lg bg-gray-200 dark:bg-gray-700" />
        <div className="h-9 w-32 rounded-lg bg-gray-200 dark:bg-gray-700" />
      </div>

      {/* Table skeleton */}
      <div className="rounded-md border">
        {/* Header row */}
        <div className="border-b px-4 py-3">
          <div className="flex gap-6">
            {[40, 60, 160, 80, 80, 80, 80].map((w, i) => (
              <div
                key={i}
                className="h-4 rounded bg-gray-200 dark:bg-gray-700"
                style={{ width: w }}
              />
            ))}
          </div>
        </div>
        {/* Data rows */}
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="border-b px-4 py-3 last:border-0">
            <div className="flex gap-6">
              {[40, 60, 160, 80, 80, 80, 80].map((w, j) => (
                <div
                  key={j}
                  className="h-4 rounded bg-gray-100 dark:bg-gray-800"
                  style={{ width: w }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
