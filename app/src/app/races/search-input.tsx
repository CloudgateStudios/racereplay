"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function SearchInput({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const params = new URLSearchParams(searchParams.toString());
    if (e.target.value) {
      params.set("q", e.target.value);
    } else {
      params.delete("q");
    }
    startTransition(() => {
      router.replace(`?${params.toString()}`);
    });
  }

  return (
    <input
      type="search"
      placeholder="Search races..."
      defaultValue={defaultValue}
      onChange={handleChange}
      className="border-input bg-background focus:ring-primary w-full rounded-lg border px-4 py-2 text-sm focus:ring-2 focus:outline-none sm:w-72"
    />
  );
}
