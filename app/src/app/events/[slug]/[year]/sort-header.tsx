"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

interface Props {
  column: string;
  label: string;
  currentSort: string;
  currentDir: string;
}

export function SortHeader({ column, label, currentSort, currentDir }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const isActive = currentSort === column;
  const nextDir = isActive && currentDir === "asc" ? "desc" : "asc";
  const arrow = isActive ? (currentDir === "asc" ? " ↑" : " ↓") : "";

  function handleClick() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", column);
    params.set("dir", nextDir);
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <button
      onClick={handleClick}
      className={`hover:text-foreground text-left font-medium whitespace-nowrap ${
        isActive ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {label}
      {arrow}
    </button>
  );
}
