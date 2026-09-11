import Stripe from "stripe";

/**
 * The Stripe client, and the one place the price is named.
 *
 * Server-only. Nothing here may be imported from a client component: the
 * secret key would be bundled if it were, and the publishable key is not
 * needed at all because checkout is Stripe's hosted page rather than an
 * embedded element.
 *
 * Constructed lazily. The module is imported by the plan page, which renders
 * for everyone including people who will never pay, and a missing key should
 * surface where billing is actually attempted rather than taking out a page
 * that only wanted to say "Free".
 */

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (client) return client;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Billing needs it; see the Stripe section of DEV.md.",
    );
  }

  // No apiVersion pin: the SDK's own default is the version its types were
  // generated against, so letting it choose is what keeps the two in step.
  client = new Stripe(key);
  return client;
}

/** Is billing configured at all? The plan page asks before offering to charge. */
export function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

export function priceId(): string {
  const id = process.env.STRIPE_PRICE_ID;
  if (!id) throw new Error("STRIPE_PRICE_ID is not set.");
  return id;
}

/**
 * What the subscription costs, for display.
 *
 * Read from Stripe rather than written here, so the page cannot drift from
 * what the customer is actually charged -- a hardcoded "$8" that disagrees
 * with the price object is the kind of mistake that ends up in a chargeback.
 */
export async function priceLabel(): Promise<string | null> {
  try {
    const price = await stripe().prices.retrieve(priceId());
    if (price.unit_amount === null) return null;

    const amount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: price.currency.toUpperCase(),
      // Whole-dollar prices read better without the trailing zeroes.
      minimumFractionDigits: price.unit_amount % 100 === 0 ? 0 : 2,
    }).format(price.unit_amount / 100);

    const interval = price.recurring?.interval;
    return interval ? `${amount} / ${interval}` : amount;
  } catch {
    // A price that cannot be read must not take the page down with it.
    return null;
  }
}
