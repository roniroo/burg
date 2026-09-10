"use client";

import { useState, useTransition } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { deleteBuilding, deleteNeighborhood } from "@/lib/actions/city";

/**
 * Delete controls for the plain, non-map surfaces.
 *
 * Both buttons confirm in place rather than in a dialog: the thing being
 * destroyed is already named on screen beside the button, and a modal that
 * only repeats that name is ceremony, not safety. The second press is a
 * different button in a different colour, so it cannot be reached by a
 * double-click on the first.
 */

const BUTTON = "border-2 border-ink px-2 py-1 font-pixel text-[10px] uppercase shadow-hard disabled:opacity-50";

function ConfirmPair({
  idle,
  armed,
  busy,
  question,
  onConfirm,
}: {
  idle: string;
  armed: string;
  busy: string;
  question: string;
  onConfirm: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className={`${BUTTON} bg-paper text-ink`}
        >
          {idle}
        </button>
        {error ? (
          <span role="status" className="font-body text-xs text-brick">
            {error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-body text-xs text-slate">{question}</span>
      <button
        type="button"
        autoFocus
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await onConfirm();
            if (result.ok) {
              setOpen(false);
              return;
            }
            setError(result.error);
            setOpen(false);
          })
        }
        className={`${BUTTON} bg-brick text-paper`}
      >
        {pending ? busy : armed}
      </button>
      <button type="button" disabled={pending} onClick={() => setOpen(false)} className={`${BUTTON} bg-snow text-ink`}>
        Keep it
      </button>
    </span>
  );
}

/** Demolish one building. `redirectTo` is for the interior, which cannot stay. */
export function DemolishBuilding({
  buildingId,
  title,
  redirectTo,
}: {
  buildingId: string;
  title: string;
  redirectTo?: Route;
}) {
  const router = useRouter();

  return (
    <ConfirmPair
      idle="Demolish"
      armed="Demolish it"
      busy="Demolishing…"
      question={`Demolish ${title}? Everything inside goes with it.`}
      onConfirm={async () => {
        const result = await deleteBuilding({ buildingId });
        if (!result.ok) return result;
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
        return { ok: true };
      }}
    />
  );
}

/** Dissolve a district, and every building standing in it. */
export function DissolveDistrict({
  neighborhoodId,
  name,
  buildingCount,
  redirectTo,
}: {
  neighborhoodId: string;
  name: string;
  buildingCount: number;
  redirectTo?: Route;
}) {
  const router = useRouter();

  return (
    <ConfirmPair
      idle="Dissolve district"
      armed="Dissolve it"
      busy="Dissolving…"
      question={
        buildingCount > 0
          ? `Dissolve ${name} and demolish the ${buildingCount} building${buildingCount === 1 ? "" : "s"} in it?`
          : `Dissolve ${name}? Its ground goes back to grass.`
      }
      onConfirm={async () => {
        const result = await deleteNeighborhood({ neighborhoodId });
        if (!result.ok) return result;
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
        return { ok: true };
      }}
    />
  );
}
