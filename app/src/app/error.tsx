"use client";

import { useEffect } from "react";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-muted-foreground mb-2 font-mono text-sm">Something went wrong</p>
      <h1 className="mb-4 text-3xl font-black tracking-tight uppercase">Unexpected error</h1>
      <p className="text-muted-foreground mb-8 max-w-sm text-sm leading-relaxed">
        An unexpected error occurred. This has been logged. Try refreshing the page or come back
        shortly.
      </p>
      <button
        onClick={reset}
        className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
