import { getCityPlan, getCityRole, getCurrentCity, getMyPlan } from "@/lib/queries";
import { refreshPlan } from "@/lib/actions/billing";
import { billingConfigured, priceLabel } from "@/lib/stripe";
import { FREE_LIMITS } from "@/lib/plan";
import { PlanActions } from "@/components/city/plan-actions";
import { Meter } from "@/components/city/meter";

export const metadata = { title: "Plan — Burg" };

/**
 * What this city is on, what it has used, and what paying changes.
 *
 * Deliberately plain, like /directory: a pricing page that oversells inside an
 * app somebody already uses is just noise between them and the button. The
 * numbers do the arguing.
 */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;

  // Re-read Stripe on every render of this page, not only when returning from
  // Checkout. Coming back from Checkout it is what stops somebody seeing "Free"
  // on the page they just paid on; the rest of the time it is what makes a
  // missed, misconfigured or out-of-order webhook self-correcting on the one
  // screen where the answer matters.
  //
  // It is close to free: `syncUser` returns without calling Stripe at all for
  // anybody who has no customer id yet, which is everybody on the free plan.
  await refreshPlan();

  const city = await getCurrentCity();
  const [plan, role] = await Promise.all([getMyPlan(), city ? getCityRole(city.id) : null]);
  const cityPlan = city ? await getCityPlan(city.id) : null;
  const price = billingConfigured() ? await priceLabel() : null;

  const isOwner = role === "owner";
  const renews = plan.currentPeriodEnd
    ? new Date(plan.currentPeriodEnd).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="font-display text-3xl">Plan</h1>
      <p className="mt-1 font-body text-sm text-stone">
        {plan.paid
          ? "You are on the paid plan. Nothing is capped."
          : "You are on the free plan."}
      </p>

      {checkout === "cancelled" ? (
        <p
          role="status"
          className="mt-4 border-2 border-mist bg-paper px-3 py-2 font-body text-sm text-slate"
        >
          Checkout was cancelled. Nothing was charged.
        </p>
      ) : null}

      {checkout === "done" && plan.paid ? (
        <p
          role="status"
          className="mt-4 border-2 border-ink bg-gold px-3 py-2 font-body text-sm text-ink"
        >
          That is done — thank you. The caps are off and you can invite people.
        </p>
      ) : null}

      {/* --- what this city has used ------------------------------------- */}
      {cityPlan && city ? (
        <section aria-labelledby="usage" className="mt-8">
          <h2 id="usage" className="font-display text-xl">
            {city.name}
          </h2>
          <p className="mt-1 font-body text-sm text-stone">
            {cityPlan.paid
              ? "Uncapped."
              : `Capped at ${FREE_LIMITS.districts} districts and ${FREE_LIMITS.buildings} buildings.`}
          </p>

          <div className="mt-3 flex flex-col gap-3">
            <Meter label="Districts" allowance={cityPlan.allowances.districts} />
            <Meter label="Buildings" allowance={cityPlan.allowances.buildings} />
          </div>

          <p className="mt-3 font-body text-xs text-stone">
            Nothing inside a building is ever capped — documents, table rows, notes and canvas
            nodes are uncounted on both plans.
          </p>
        </section>
      ) : null}

      {/* --- what the two plans are --------------------------------------- */}
      <section aria-labelledby="tiers" className="mt-10">
        <h2 id="tiers" className="font-display text-xl">
          What paying changes
        </h2>

        <div className="mt-3 overflow-x-auto border-2 border-ink">
          <table className="w-full border-collapse font-body text-sm">
            <caption className="sr-only">The free and paid plans compared.</caption>
            <thead className="bg-mist">
              <tr>
                <th
                  scope="col"
                  className="border-b-2 border-ink px-3 py-2 text-left font-pixel text-[10px] uppercase"
                >
                  &nbsp;
                </th>
                <th
                  scope="col"
                  className="border-b-2 border-ink px-3 py-2 text-left font-pixel text-[10px] uppercase"
                >
                  Free
                </th>
                <th
                  scope="col"
                  className="border-b-2 border-ink px-3 py-2 text-left font-pixel text-[10px] uppercase"
                >
                  Paid{price ? ` — ${price}` : ""}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="odd:bg-paper even:bg-snow">
                <th scope="row" className="border-b border-mist px-3 py-2 text-left font-normal">
                  Districts
                </th>
                <td className="border-b border-mist px-3 py-2">{FREE_LIMITS.districts}</td>
                <td className="border-b border-mist px-3 py-2">Unlimited</td>
              </tr>
              <tr className="odd:bg-paper even:bg-snow">
                <th scope="row" className="border-b border-mist px-3 py-2 text-left font-normal">
                  Buildings
                </th>
                <td className="border-b border-mist px-3 py-2">{FREE_LIMITS.buildings}</td>
                <td className="border-b border-mist px-3 py-2">Unlimited</td>
              </tr>
              <tr className="odd:bg-paper even:bg-snow">
                <th scope="row" className="border-b border-mist px-3 py-2 text-left font-normal">
                  Inside a building
                </th>
                <td className="border-b border-mist px-3 py-2">Uncapped</td>
                <td className="border-b border-mist px-3 py-2">Uncapped</td>
              </tr>
              <tr className="odd:bg-paper even:bg-snow">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  People to share it with
                </th>
                <td className="px-3 py-2 text-stone">—</td>
                <td className="px-3 py-2">Editors and viewers</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* --- the button --------------------------------------------------- */}
      <section aria-labelledby="billing" className="mt-10 mb-6">
        <h2 id="billing" className="font-display text-xl">
          Billing
        </h2>

        {plan.paid && plan.status !== "comped" ? (
          <p className="mt-1 font-body text-sm text-stone">
            {plan.cancelAtPeriodEnd
              ? `Cancelled. You keep the paid plan until ${renews ?? "the period ends"}.`
              : renews
                ? `Renews on ${renews}.`
                : "Active."}
            {plan.status === "past_due"
              ? " The last payment failed and Stripe is retrying — update the card to avoid losing it."
              : ""}
          </p>
        ) : plan.status === "comped" ? (
          <p className="mt-1 font-body text-sm text-stone">
            This account has the paid plan without a subscription. There is nothing to bill.
          </p>
        ) : (
          <p className="mt-1 font-body text-sm text-stone">
            {isOwner
              ? "Card details are handled by Stripe; they never reach Burg."
              : "You are a guest in this city. Its owner decides its plan — this page bills your own account, not theirs."}
          </p>
        )}

        {billingConfigured() ? (
          <PlanActions paid={plan.paid} comped={plan.status === "comped"} />
        ) : (
          <p className="mt-3 font-body text-sm text-brick">
            Billing is not configured on this deployment.
          </p>
        )}
      </section>
    </div>
  );
}
