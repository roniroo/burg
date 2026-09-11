import type { Allowance } from "@/lib/plan";

/**
 * How much of a capped allowance is gone.
 *
 * A bar rather than a number alone, because "42 of 50" is a fact and a bar
 * that is nearly full is a warning -- and the whole argument for capping the
 * deliberate acts rather than the invisible ones is that somebody should be
 * able to see the wall coming.
 *
 * Stepped in eighths rather than drawn to the exact percentage: the house
 * style is an 8px grid and no anti-aliased anything, and a bar that lands on a
 * fractional pixel is the one element on the page that looks resampled.
 */
export function Meter({ label, allowance }: { label: string; allowance: Allowance }) {
  const { used, limit, remaining, full } = allowance;

  if (limit === null) {
    return (
      <div className="flex items-baseline justify-between gap-3 border-2 border-ink bg-snow px-3 py-2">
        <span className="font-pixel text-[10px] uppercase text-ink">{label}</span>
        <span className="font-body text-sm text-stone">
          {used} · <span className="text-slate">no limit</span>
        </span>
      </div>
    );
  }

  // At least one cell once anything is used: rounding 1-of-50 to zero draws an
  // empty bar for a city that is not empty, which is the one thing a usage
  // meter must never say.
  const eighths = used === 0 ? 0 : Math.min(8, Math.max(1, Math.round((used / limit) * 8)));

  return (
    <div className="border-2 border-ink bg-snow px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-pixel text-[10px] uppercase text-ink">{label}</span>
        <span className="font-body text-sm text-stone">
          {used} of {limit}
          {full ? (
            <span className="ml-2 font-pixel text-[10px] uppercase text-brick">full</span>
          ) : (
            <span className="ml-2 text-slate">{remaining} left</span>
          )}
        </span>
      </div>

      {/* Decorative: the numbers above already say this, and a screen reader
          reading eight cells would be worse than useless. */}
      <div aria-hidden className="mt-2 flex gap-1">
        {Array.from({ length: 8 }, (_, i) => (
          <span
            key={i}
            className={`h-2 flex-1 border-2 border-ink ${
              i < eighths ? (full ? "bg-brick" : "bg-amber") : "bg-paper"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
