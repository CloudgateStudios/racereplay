"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  genders: string[];
  divisions: string[];
}

export function EventFilters({ genders, divisions }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== "all") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page");
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [router, pathname, searchParams]
  );

  // Debounced variant for the text search box — waits 200ms after the user
  // stops typing before pushing to the router to reduce excessive URL updates.
  const updateSearchDebounced = useCallback(
    (value: string) => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => updateParam("q", value), 200);
    },
    [updateParam]
  );

  const genderValue: string = searchParams.get("gender") ?? "all";
  const divisionValue: string = searchParams.get("division") ?? "all";

  return (
    <div className="mb-6">
      <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
        Filters
      </p>
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground text-xs font-medium">Search</label>
          <Input
            placeholder="Name or bib…"
            defaultValue={searchParams.get("q") ?? ""}
            onChange={(e) => updateSearchDebounced(e.target.value)}
            className="w-56"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground text-xs font-medium">Gender</label>
          <Select defaultValue={genderValue} onValueChange={(v) => updateParam("gender", v ?? "")}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All genders" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All genders</SelectItem>
              {genders.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground text-xs font-medium">Division</label>
          <Select
            defaultValue={divisionValue}
            onValueChange={(v) => updateParam("division", v ?? "")}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All divisions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All divisions</SelectItem>
              {divisions.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
