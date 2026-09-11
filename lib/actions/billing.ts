"use server";

import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { customerFor, syncUser } from "@/lib/billing";
import { billingConfigured, priceId, stripe } from "@/lib/stripe";
import { isEntitled } from "@/lib/plan";
import type { ActionResult } from "@/lib/actions/city";

/**
 * Starting and managing a subscription.
 *
 * Both actions end in a redirect to a Stripe-hosted page. Nothing about a card
 * is ever typed into Burg, which is the reason to use Checkout and the Billing
 * Portal rather than building either screen here: no card data touches this
 * server, so there is nothing here to get PCI wrong.
 *
 * The origin is taken from the request rather than from an env var, the same
 * way `app/auth/callback/route.ts` does it. `NEXT_PUBLIC_SITE_URL` exists but
 * is not read by the app, and a return URL that silently points at localhost
 * in production is a bad way to find that out.
 */

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

/** Send the signed-in user to Stripe Checkout for the one subscription price. */
export async function startCheckout(): Promise<ActionResult> {
  if (!billingConfigured()) {
    return { ok: false, error: "Billing is not configured on this deployment." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // The page offers "Manage billing" rather than "Upgrade" to somebody who is
  // already paying, so reaching here means the action was called directly. Left
  // unguarded it would open a second checkout and bill them twice for the same
  // thing, which is the one mistake in this file that costs somebody money.
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (isEntitled(existing?.status)) {
    return { ok: false, error: "You are already on the paid plan." };
  }

  let url: string;
  try {
    const customer = await customerFor(user.id, user.email);
    const base = await origin();

    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price: priceId(), quantity: 1 }],
      // Both are needed. `client_reference_id` is what a human reads in the
      // dashboard when reconciling a payment to an account; the metadata is
      // what code reads.
      client_reference_id: user.id,
      subscription_data: { metadata: { burg_user_id: user.id } },
      success_url: `${base}/plan?checkout=done`,
      cancel_url: `${base}/plan?checkout=cancelled`,
      allow_promotion_codes: true,
    });

    if (!session.url) return { ok: false, error: "Stripe did not return a checkout page." };
    url = session.url;
  } catch (error) {
    console.error("[burg] checkout failed", error);
    return { ok: false, error: "Could not reach Stripe. Try again in a moment." };
  }

  // Outside the try: redirect() works by throwing, so catching around it would
  // swallow the navigation and report a Stripe failure that did not happen.
  // The cast is for `typedRoutes`, which types redirect() against this app's
  // own routes; Stripe's URL is absolute and external, which redirect()
  // handles at runtime but the route type cannot describe.
  redirect(url as Route);
}

/**
 * Send them to Stripe's Billing Portal to change card, cancel, or resubscribe.
 *
 * Cancelling is deliberately not a button in Burg. The portal is where Stripe
 * keeps the invoice history and the cancellation flow, and a home-made cancel
 * button that only writes to our own table would leave Stripe still charging.
 */
export async function openBillingPortal(): Promise<ActionResult> {
  if (!billingConfigured()) {
    return { ok: false, error: "Billing is not configured on this deployment." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  let url: string;
  try {
    const customer = await customerFor(user.id, user.email);
    const base = await origin();
    const session = await stripe().billingPortal.sessions.create({
      customer,
      return_url: `${base}/plan`,
    });
    url = session.url;
  } catch (error) {
    console.error("[burg] billing portal failed", error);
    return {
      ok: false,
      error:
        "Could not open the billing portal. If this is a fresh Stripe account, its portal settings may need saving once in the dashboard.",
    };
  }

  redirect(url as Route);
}

/**
 * Re-read Stripe for the signed-in user.
 *
 * Called when returning from Checkout, where waiting on the webhook would mean
 * showing someone the free plan on the page they just paid on.
 */
export async function refreshPlan(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  try {
    await syncUser(user.id);
  } catch (error) {
    // A failed resync must not take down the plan page; the webhook is the
    // other half of this and will arrive.
    console.error("[burg] plan resync failed for", user.id, error);
  }
}
