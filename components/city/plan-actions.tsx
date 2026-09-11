"use client";

import { useState, useTransition } from "react";
import { openBillingPortal, startCheckout } from "@/lib/actions/billing";

/**
 * The two billing buttons.
 *
 * Both server actions end in `redirect()` to a Stripe-hosted page, so the
 * success path never returns here -- the only thing that comes back is a
 * failure, which is why `run` only ever has an error to deal with. A "done!"
 * state would be unreachable code.
 */

const BUTTON =
  "mt-3 border-2 border-ink px-3 py-1 font-pixel text-xs uppercase shadow-hard disabled:opacity-50";

export function PlanActions({ paid, comped }: { paid: boolean; comped: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.error);
    });

  // A comped account has no Stripe customer behind it, so the portal would
  // open on an empty account and Checkout would charge for something already
  // granted. Neither button is honest here.
  if (comped) return null;

  return (
    <div>
      {paid ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(openBillingPortal)}
          className={`${BUTTON} bg-paper text-ink`}
        >
          {pending ? "…" : "Manage billing"}
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(startCheckout)}
          className={`${BUTTON} bg-gold text-ink`}
        >
          {pending ? "…" : "Upgrade"}
        </button>
      )}

      {paid ? (
        <p className="mt-2 font-body text-xs text-stone">
          Card, invoices and cancellation all live in Stripe&rsquo;s portal.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 font-body text-xs text-brick">
          {error}
        </p>
      ) : null}
    </div>
  );
}
