"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setBuildingLook } from "@/lib/actions/city";

export type LookOption = { id: string; name: string; footprint_w: number; footprint_h: number };

/**
 * What a building wears: its usual look, or a sprite from the library.
 *
 * A plain select, because the choice is a name and a lot size; the pictures
 * are on the Sprites page. A sprite that needs a bigger lot than there is room
 * for is refused by the server with the reason, and the select goes back.
 */
export function LookPicker({
  buildingId,
  current,
  sprites,
}: {
  buildingId: string;
  current: string | null;
  sprites: LookOption[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (sprites.length === 0) {
    return (
      <Link
        href="/sprites"
        className="font-pixel text-[10px] uppercase text-stone underline decoration-mist underline-offset-4 hover:text-ink"
      >
        Upload a look
      </Link>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <label htmlFor="building-look" className="font-pixel text-[10px] uppercase text-stone">
        Look
      </label>
      <select
        id="building-look"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const previous = value;
          setValue(next);
          setError(null);
          startTransition(async () => {
            const result = await setBuildingLook({ buildingId, spriteId: next || null });
            if (result.ok) router.refresh();
            else {
              setValue(previous);
              setError(result.error);
            }
          });
        }}
        className="border-2 border-ink bg-paper px-2 py-1 font-pixel text-[10px] uppercase text-ink shadow-hard disabled:opacity-50"
      >
        <option value="">Usual look</option>
        {sprites.map((sprite) => (
          <option key={sprite.id} value={sprite.id}>
            {sprite.name} ({sprite.footprint_w}×{sprite.footprint_h})
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="w-full font-body text-xs text-brick">
          {error}
        </span>
      ) : null}
    </span>
  );
}
