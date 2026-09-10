"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearCity } from "@/lib/actions/city";

type Scope = "buildings" | "everything";

/**
 * Clear the city in one go.
 *
 * The guard is typing the city's own name, not an "are you sure" -- this is
 * the only control in Burg that can destroy hundreds of things at once, and
 * it should cost a sentence of effort. The name is checked again server-side;
 * this form is a courtesy, not the boundary.
 */
export function StartFresh({
  cityId,
  cityName,
  buildingCount,
  neighborhoodCount,
}: {
  cityId: string;
  cityName: string;
  buildingCount: number;
  neighborhoodCount: number;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [scope, setScope] = useState<Scope>("buildings");
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = typed.trim().toLowerCase() === cityName.toLowerCase();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await clearCity({ cityId, scope, confirmName: typed.trim() });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setTyped("");
      setMessage(
        result.data.neighborhoods > 0
          ? `Cleared. ${result.data.buildings} buildings and ${result.data.neighborhoods} districts are gone.`
          : `Cleared. ${result.data.buildings} building${result.data.buildings === 1 ? "" : "s"} demolished.`,
      );
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 border-2 border-brick bg-snow p-3 shadow-hard">
      <fieldset>
        <legend className="font-pixel text-[10px] uppercase text-brick">How much</legend>
        <div className="mt-2 flex flex-col gap-1">
          <label className="flex items-center gap-2 font-body text-sm">
            <input
              type="radio"
              name="clear-scope"
              value="buildings"
              checked={scope === "buildings"}
              onChange={() => setScope("buildings")}
            />
            Demolish all {buildingCount} building{buildingCount === 1 ? "" : "s"}, keep the districts
          </label>
          <label className="flex items-center gap-2 font-body text-sm">
            <input
              type="radio"
              name="clear-scope"
              value="everything"
              checked={scope === "everything"}
              onChange={() => setScope("everything")}
            />
            Everything — buildings and all {neighborhoodCount} district
            {neighborhoodCount === 1 ? "" : "s"}, back to open ground
          </label>
        </div>
      </fieldset>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId} className="font-pixel text-[10px] uppercase text-stone">
            Type “{cityName}” to confirm
          </label>
          <input
            id={fieldId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            placeholder={cityName}
            className="w-56 border-2 border-ink bg-paper px-2 py-1 font-body text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending || !matches}
          className="border-2 border-ink bg-brick px-3 py-1 font-pixel text-[10px] uppercase text-paper shadow-hard disabled:opacity-40"
        >
          {pending ? "Clearing…" : "Clear it"}
        </button>
      </div>

      {message ? (
        <p role="status" aria-live="polite" className="mt-2 font-body text-xs text-slate">
          {message}
        </p>
      ) : null}
    </form>
  );
}
