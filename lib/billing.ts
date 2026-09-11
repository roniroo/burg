import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";

/**
 * Keeping `public.subscriptions` in step with Stripe.
 *
 * Server-only, like `createAdminClient` itself: never import this from a
 * client component.
 *
 * Everything here writes with the service role, and that is the whole design
 * rather than a shortcut. The table has no insert or update policy, so a
 * client holding the anon key cannot write it at all -- which matters, because
 * a user who could write their own subscription row could simply set
 * `status = 'active'` through PostgREST and grant themselves the paid plan.
 * Stripe is also not a signed-in user, so a webhook could not write as one
 * even if we wanted it to.
 *
 * This is the only runtime use of `SUPABASE_SERVICE_ROLE_KEY` in the app, and
 * it is new: before billing, the key was needed by `npm run seed` and nothing
 * else, and it was deliberately not set on the web service. Billing needs it
 * deployed. See the Billing section of DEV.md.
 *
 * Two things keep the table honest, and they overlap on purpose:
 *
 *   the webhook   Stripe tells us the moment anything changes.
 *   `syncUser`    the plan page re-reads Stripe when it renders, so the state
 *                 is correct on the screen where it matters even if a webhook
 *                 was missed, never configured, or arrived out of order.
 *
 * Out-of-order delivery is the reason the resync exists at all rather than
 * being belt-and-braces: Stripe does not guarantee event ordering, so a
 * `customer.subscription.updated` can land after the `deleted` that followed
 * it. Both paths therefore write from a *fresh read of Stripe* rather than
 * from the event payload, so the last writer still writes the truth.
 */

/** The period end moved onto the subscription item; the subscription itself no
    longer carries one. Reading the old place silently yields undefined, which
    is how a "renews on" line quietly becomes blank. */
function periodEnd(subscription: Stripe.Subscription): string | null {
  const seconds = subscription.items.data[0]?.current_period_end;
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function customerIdOf(subscription: Stripe.Subscription): string {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;
}

/**
 * The subscription that decides, when a customer has more than one.
 *
 * Picks an entitling one over a dead one, so a resubscribe after a
 * cancellation does not report the cancellation. Within that, the newest.
 */
function decisive(subscriptions: Stripe.Subscription[]): Stripe.Subscription | null {
  if (subscriptions.length === 0) return null;
  const living = subscriptions.filter(
    (s) => !["canceled", "incomplete_expired", "unpaid"].includes(s.status),
  );
  const pool = living.length > 0 ? living : subscriptions;
  return pool.sort((a, b) => b.created - a.created)[0] ?? null;
}

/** Write what Stripe currently says about one user. */
async function write(
  userId: string,
  row: {
    status: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    price_id: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  },
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("subscriptions")
    .upsert({ user_id: userId, ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`could not record the subscription: ${error.message}`);
}

/** The Burg user a Stripe customer belongs to, or null if we have never seen it. */
export async function userForCustomer(customerId: string): Promise<string | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (data) return data.user_id;

  // A customer created during a checkout that never completed has no row yet.
  // The id was stamped into the customer's metadata when it was made, so the
  // link survives even when our side has nothing written down.
  try {
    const customer = await stripe().customers.retrieve(customerId);
    if (!customer.deleted && customer.metadata?.burg_user_id) {
      return customer.metadata.burg_user_id;
    }
  } catch {
    // A customer we cannot read tells us nothing; treat it as unknown.
  }
  return null;
}

/**
 * Re-read Stripe for one user and write down what it says.
 *
 * Comped accounts are left alone. They have no Stripe customer at all, and a
 * resync that "corrected" them to `none` would quietly revoke access that was
 * granted by hand.
 */
export async function syncUser(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("subscriptions")
    .select("status, stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (row?.status === "comped") return;

  const customerId = row?.stripe_customer_id;
  if (!customerId) return;

  const list = await stripe().subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });

  const subscription = decisive(list.data);
  if (!subscription) {
    await write(userId, {
      status: "none",
      stripe_customer_id: customerId,
      stripe_subscription_id: null,
      price_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
    });
    return;
  }

  await write(userId, {
    status: subscription.status,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    price_id: subscription.items.data[0]?.price.id ?? null,
    current_period_end: periodEnd(subscription),
    cancel_at_period_end: subscription.cancel_at_period_end,
  });
}

/**
 * Write down which Stripe customer a user is, before anything needs to read it.
 *
 * `syncUser` finds the subscriptions by customer id and gives up quietly if the
 * row has none, so every path that learns a customer id has to record it first.
 * Normally `customerFor` already did, at checkout -- but not for a customer
 * created outside that flow, such as one made by hand in the dashboard.
 */
async function linkCustomer(userId: string, customerId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("subscriptions")
    .upsert(
      { user_id: userId, stripe_customer_id: customerId, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
}

/** Record the customer if we have one, then re-read Stripe for that user. */
export async function syncCustomer(userId: string, customerId: string | null): Promise<void> {
  if (customerId) await linkCustomer(userId, customerId);
  await syncUser(userId);
}

/**
 * Handle one subscription-shaped event.
 *
 * Deliberately re-reads the customer's subscriptions rather than trusting the
 * payload, so a late-arriving stale event cannot undo a newer one.
 */
export async function syncFromSubscription(subscription: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(subscription);
  const userId = await userForCustomer(customerId);
  if (!userId) return;
  await syncCustomer(userId, customerId);
}

/**
 * The Stripe customer for a user, made if this is their first time.
 *
 * The Burg user id goes into the customer's metadata, which is what lets a
 * webhook find its way back to an account when our own row is missing.
 */
export async function customerFor(userId: string, email: string | undefined): Promise<string> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (row?.stripe_customer_id) return row.stripe_customer_id;

  const customer = await stripe().customers.create({
    email,
    metadata: { burg_user_id: userId },
  });

  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id: customer.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`could not record the Stripe customer: ${error.message}`);

  return customer.id;
}
