"use client";

import { useEffect } from "react";
import Link from "next/link";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function EventError({ error, reset }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-muted-foreground mb-2 font-mono text-sm">Error loading results</p>
      <h1 className="mb-4 text-3xl font-black tracking-tight uppercase">Could not load event</h1>
      <p className="text-muted-foreground mb-8 max-w-sm text-sm leading-relaxed">
        The results for this event couldn&apos;t be loaded. Try again or browse all races.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          Try again
        </button>
        <Link
          href="/races"
          className="bg-card hover:border-primary/50 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
        >
          Browse races
        </Link>
      </div>
    </div>
  );
}
