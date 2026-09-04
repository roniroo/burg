"use client";

import { useEffect, useRef, useState } from "react";
import { animate, createTimer } from "animejs";
import { AMBIENT, daylightAt, type Daylight } from "@/lib/daylight";
import { STEP_SPRITE } from "@/lib/anim";
import { useReducedMotion } from "@/lib/use-reduced-motion";

const NOON = daylightAt(new Date(2026, 0, 1, 12, 0, 0));

/**
 * The clock, read once a minute.
 *
 * The cycle follows the viewer's own local time, so the city is dark when it
 * is dark where they are.
 */
export function useDaylight(): Daylight {
  // Seeded from a fixed reference hour rather than `new Date()`: the server
  // renders in its own timezone and the browser in the viewer's, and the two
  // disagreeing is a hydration mismatch. The effect below corrects it on the
  // first client frame.
  const [light, setLight] = useState(NOON);

  useEffect(() => {
    const tick = () => setLight(daylightAt(new Date()));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  return light;
}

/** True while the tab is actually being looked at. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}

/**
 * Ambient life over the map: the sky, the light of the hour, and the small
 * loops that make the city feel inhabited.
 *
 * Everything here stops under `prefers-reduced-motion` and whenever the tab is
 * hidden -- an animation nobody is watching is pure battery drain.
 */
export function AmbientLayer({ light }: { light: Daylight }) {
  const visible = usePageVisible();
  const birdRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !visible) return;
    const bird = birdRef.current;
    if (!bird) return;

    const fly = () => {
      animate(bird, {
        translateX: ["-8vw", "108vw"],
        translateY: [0, -18, 6, 0],
        duration: 9_000,
        ease: STEP_SPRITE,
      });
    };

    // One pass shortly after arriving, then on the ambient cadence.
    const first = window.setTimeout(fly, 4_000);
    const timer = createTimer({ duration: AMBIENT.birdEveryMs, loop: true, onLoop: fly });

    return () => {
      window.clearTimeout(first);
      timer.pause();
    };
  }, [reduced, visible]);

  return (
    <>
      {/* Sky. The one permitted gradient. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(to bottom, ${light.skyTop}, ${light.skyBottom})`,
          zIndex: 0,
        }}
      />

      {/* The light of the hour, laid over the world. */}
      {light.ambientOpacity > 0 ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundColor: light.ambientTint,
            opacity: light.ambientOpacity,
            zIndex: 9_000,
            mixBlendMode: "multiply",
          }}
        />
      ) : null}

      {/* A bird, every forty seconds or so. */}
      <div
        ref={birdRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-16"
        style={{ zIndex: 9_001, opacity: reduced ? 0 : 1 }}
      >
        <svg width={16} height={8} className="pixelated block" shapeRendering="crispEdges">
          <polygon points="0,4 4,0 6,4 8,2 10,4 14,0 16,4 8,6" fill="var(--color-ink)" />
        </svg>
      </div>
    </>
  );
}
