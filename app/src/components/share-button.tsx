"use client";

import { useState, useEffect } from "react";

export function ShareButton() {
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  // Detect after mount — navigator is not available during SSR
  useEffect(() => {
    setCanNativeShare(!!navigator.share);
  }, []);

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch {
        // User cancelled or share failed — fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleShare}
      className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
    >
      {copied ? (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-3.5 w-3.5 text-green-500"
          >
            <path
              fillRule="evenodd"
              d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-green-500">Copied!</span>
        </>
      ) : canNativeShare ? (
        // On platforms with a native share sheet (iOS, Android, macOS Safari)
        // just label it "Share" — the OS provides its own iconography in the sheet
        "Share"
      ) : (
        // Desktop fallback — copy to clipboard, so label it accordingly
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-3.5 w-3.5"
          >
            <path d="M5.5 3.5A1.5 1.5 0 0 1 7 2h2.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 1 .439 1.061V9.5A1.5 1.5 0 0 1 12 11h-.5v1.5A1.5 1.5 0 0 1 10 14H4a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 4 4h.5v-.5H5.5ZM4 5.5v7h6v-7H4ZM9.5 4H7a.5.5 0 0 0-.5.5V5h3.5v-.379L9.5 4Z" />
          </svg>
          Copy link
        </>
      )}
    </button>
  );
}
