"use client";

import { useEffect, useRef } from "react";
import { animate } from "animejs";
import { useReducedMotion } from "@/lib/use-reduced-motion";

export type Headline = { id: string; text: string };

/**
 * The news ticker.
 *
 * Recent activity, written as small-town newspaper headlines. It scrolls when
 * motion is allowed; under reduced motion it becomes a plain, readable list
 * that does not move at all, which is the only honest way to keep the
 * information available.
 */
export function Ticker({ headlines }: { headlines: Headline[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const track = trackRef.current;
    if (!track) return;

    const distance = track.scrollWidth / 2;
    if (distance <= 0) return;

    const animation = animate(track, {
      translateX: [0, -distance],
      duration: Math.max(18_000, distance * 24),
      ease: "linear",
      loop: true,
    });

    const onVisibility = () => {
      if (document.visibilityState === "visible") animation.play();
      else animation.pause();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      animation.pause();
    };
  }, [reduced, headlines]);

  if (headlines.length === 0) return null;

  if (reduced) {
    return (
      <section
        aria-label="Recent activity"
        className="border-t-2 border-ink bg-paper px-3 py-1"
      >
        <ul className="flex flex-col gap-0.5">
          {headlines.slice(0, 3).map((headline) => (
            <li key={headline.id} className="font-pixel text-[10px] uppercase text-ink">
              {headline.text}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section
      aria-label="Recent activity"
      className="overflow-hidden border-t-2 border-ink bg-paper"
    >
      {/* Duplicated once so the loop has something to scroll into. */}
      <div ref={trackRef} className="flex w-max whitespace-nowrap py-1">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex" aria-hidden={copy === 1}>
            {headlines.map((headline) => (
              <span
                key={`${copy}-${headline.id}`}
                className="px-6 font-pixel text-[10px] uppercase text-ink"
              >
                ◆ {headline.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
