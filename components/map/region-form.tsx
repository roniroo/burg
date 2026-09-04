"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveNeighborhood } from "@/lib/actions/city";

/**
 * Move or resize a district.
 *
 * A form rather than a drag handle on the map: this is the accessible path,
 * it is exact, and relocating a region carries every building in it, which is
 * not a gesture that benefits from being imprecise. The server refuses a
 * change that would push a building outside or overlap another district.
 */
export function RegionForm({
  neighborhoodId,
  originX,
  originY,
  width,
  height,
}: {
  neighborhoodId: string;
  originX: number;
  originY: number;
  width: number;
  height: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState({ originX, originY, width, height });
  const [message, setMessage] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await moveNeighborhood({ neighborhoodId, ...values });
      if (result.ok) {
        setMessage("Moved.");
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  }

  const field = (key: keyof typeof values, label: string, min: number, max: number) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`region-${key}`} className="font-pixel text-[10px] uppercase text-stone">
        {label}
      </label>
      <input
        id={`region-${key}`}
        type="number"
        min={min}
        max={max}
        value={values[key]}
        onChange={(e) => setValues((v) => ({ ...v, [key]: Number(e.target.value) || min }))}
        className="w-20 border-2 border-ink bg-paper px-2 py-1 font-body text-sm"
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="mt-6 border-2 border-ink bg-snow p-3 shadow-hard">
      <h2 className="font-pixel text-[10px] uppercase text-stone">Region</h2>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        {field("originX", "X", 0, 511)}
        {field("originY", "Y", 0, 511)}
        {field("width", "Width", 3, 40)}
        {field("height", "Height", 3, 40)}
        <button
          type="submit"
          disabled={pending}
          className="border-2 border-ink bg-amber px-3 py-1 font-pixel text-[10px] uppercase shadow-hard disabled:opacity-50"
        >
          {pending ? "Moving…" : "Apply"}
        </button>
      </div>
      {message ? (
        <p role="status" className="mt-2 font-body text-xs text-stone">
          {message}
        </p>
      ) : null}
    </form>
  );
}
