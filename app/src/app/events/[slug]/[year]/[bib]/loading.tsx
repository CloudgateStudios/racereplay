export default function AthleteLoading() {
  return (
    <div className="animate-pulse">
      {/* Breadcrumb skeleton */}
      <div className="mb-4 h-4 w-64 rounded bg-gray-200 dark:bg-gray-700" />

      {/* Athlete name skeleton */}
      <div className="mt-3 mb-8">
        <div className="mb-3 h-10 w-64 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="flex gap-2">
          {[60, 80, 60, 70].map((w, i) => (
            <div
              key={i}
              className="h-6 rounded-full bg-gray-200 dark:bg-gray-700"
              style={{ width: w }}
            />
          ))}
        </div>
      </div>

      {/* Rank cards skeleton */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-card rounded-xl border p-4 shadow-sm">
            <div className="mb-2 h-3 w-20 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-8 w-24 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>

      {/* Leg table skeleton */}
      <div className="mb-2 h-6 w-48 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="mt-3 rounded-md border">
        <div className="border-b px-4 py-3">
          <div className="flex gap-6">
            {[100, 80, 80, 60, 80, 60].map((w, i) => (
              <div
                key={i}
                className="h-4 rounded bg-gray-200 dark:bg-gray-700"
                style={{ width: w }}
              />
            ))}
          </div>
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-b px-4 py-3 last:border-0">
            <div className="flex gap-6">
              {[100, 80, 80, 60, 80, 60].map((w, j) => (
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
