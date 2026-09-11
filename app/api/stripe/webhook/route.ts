import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { syncCustomer, syncFromSubscription, userForCustomer } from "@/lib/billing";

/**
 * Stripe's side of the conversation.
 *
 * The signature check is the authentication. This route is necessarily public
 * -- Stripe is not signed in and never will be -- so the only thing separating
 * a real event from anyone who found the URL is
 * `stripe.webhooks.constructEvent`, which verifies an HMAC of the *raw* body
 * against `STRIPE_WEBHOOK_SECRET`. Hence `await request.text()` and not
 * `request.json()`: parsing and re-serialising changes the bytes and the
 * signature stops matching, which is a confusing way to discover this.
 *
 * Note this route has to be excluded from the auth matcher in `proxy.ts`, or
 * the middleware redirects Stripe to the sign-in page and every event fails.
 *
 * Every branch re-reads Stripe rather than trusting the payload it was handed,
 * because delivery is not ordered: a stale `updated` can arrive after the
 * `deleted` that superseded it. See lib/billing.ts.
 */

/** Events worth acting on. Anything else is acknowledged and ignored. */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
]);

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[burg] STRIPE_WEBHOOK_SECRET is not set; refusing the event");
    return new Response("webhook not configured", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("no signature", { status: 400 });

  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    // 400, not 500: the event is not going to verify on a retry either, and a
    // 500 would have Stripe redeliver it for days.
    console.error("[burg] webhook signature rejected", error);
    return new Response("bad signature", { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    return Response.json({ received: true, handled: false });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // client_reference_id is set at checkout, so this works even on the
        // very first event for a customer we have not recorded yet.
        const userId =
          session.client_reference_id ??
          (typeof session.customer === "string" ? await userForCustomer(session.customer) : null);
        // Pass the customer through rather than only the user: on a first
        // subscription this may be the first time anything can link the two,
        // and syncUser gives up quietly on a row with no customer id.
        if (userId) {
          await syncCustomer(userId, typeof session.customer === "string" ? session.customer : null);
        }
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customer =
          typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (customer) {
          const userId = await userForCustomer(customer);
          if (userId) await syncCustomer(userId, customer);
        }
        break;
      }

      default: {
        await syncFromSubscription(event.data.object as Stripe.Subscription);
        break;
      }
    }
  } catch (error) {
    // 500 so Stripe retries: a write that failed because the database blinked
    // is exactly what redelivery is for.
    console.error("[burg] webhook handling failed", event.type, error);
    return new Response("handler failed", { status: 500 });
  }

  return Response.json({ received: true, handled: true });
}
