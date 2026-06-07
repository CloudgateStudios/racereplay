"use client";

import { useEffect } from "react";
import Link from "next/link";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AthleteError({ error, reset }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-muted-foreground mb-2 font-mono text-sm">Error loading athlete</p>
      <h1 className="mb-4 text-3xl font-black tracking-tight uppercase">
        Could not load athlete data
      </h1>
      <p className="text-muted-foreground mb-8 max-w-sm text-sm leading-relaxed">
        This athlete&apos;s results couldn&apos;t be loaded. Try again or go back to the event.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          Try again
        </button>
        <Link
          href=".."
          className="bg-card hover:border-primary/50 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
        >
          Back to results
        </Link>
      </div>
    </div>
  );
}
