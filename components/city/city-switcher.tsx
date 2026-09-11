"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { switchCity } from "@/lib/actions/members";
import type { CityRole } from "@/lib/queries";

/**
 * Which city you are looking at.
 *
 * Only rendered when there is more than one to choose from — until someone
 * shares a city with you, this is a select with one option, which is noise.
 */
export function CitySwitcher({
  cities,
  activeId,
}: {
  cities: Array<{ id: string; name: string; role: CityRole }>;
  activeId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <span className="flex items-center gap-1">
      <label htmlFor="city-switcher" className="sr-only">
        Which city
      </label>
      <select
        id="city-switcher"
        value={activeId}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(async () => {
            const result = await switchCity({ cityId: next });
            if (result.ok) router.push("/city");
          });
        }}
        className="border-2 border-ink bg-paper px-2 py-1 font-pixel text-[10px] uppercase text-ink shadow-hard"
      >
        {cities.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.role === "owner" ? "" : ` (${c.role})`}
          </option>
        ))}
      </select>
    </span>
  );
}
