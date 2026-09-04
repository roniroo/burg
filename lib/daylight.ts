/**
 * The day/night cycle.
 *
 * Pure: a clock time in, a description of the light out. No DOM, no React, no
 * Date.now() inside -- the caller supplies the time, which is what makes this
 * testable and what lets the map preview any hour.
 *
 * The sky is the one place in Burg where a gradient is allowed.
 */

export type Phase = "night" | "dawn" | "day" | "dusk";

export type Daylight = {
  phase: Phase;
  /** Sky gradient stops, top to bottom. */
  skyTop: string;
  skyBottom: string;
  /** Streetlamps and window lights come on together, at dusk. */
  lampsOn: boolean;
  /** 1 at noon, longer toward the horizons. Multiplies the shadow offset. */
  shadowScale: number;
  /** How far through the lit part of the day, 0 at sunrise and 1 at sunset. */
  sunProgress: number;
  /** A wash laid over the whole world, warm at golden hour and blue at night. */
  ambientTint: string;
  ambientOpacity: number;
};

const SUNRISE = 6;
const SUNSET = 20;

/** Hour as a float, 0-24, from a Date in the viewer's own timezone. */
export function hourOf(date: Date): number {
  return date.getHours() + date.getMinutes() / 60;
}

function phaseFor(hour: number): Phase {
  if (hour < 5 || hour >= 21) return "night";
  if (hour < 8) return "dawn";
  if (hour < 18) return "day";
  return "dusk";
}

const SKY: Record<Phase, { top: string; bottom: string }> = {
  night: { top: "var(--color-void)", bottom: "var(--color-deep)" },
  dawn: { top: "var(--color-plum)", bottom: "var(--color-amber)" },
  day: { top: "var(--color-water)", bottom: "var(--color-sky)" },
  dusk: { top: "var(--color-plum)", bottom: "var(--color-clay)" },
};

const TINT: Record<Phase, { colour: string; opacity: number }> = {
  night: { colour: "var(--color-deep)", opacity: 0.35 },
  dawn: { colour: "var(--color-amber)", opacity: 0.12 },
  day: { colour: "var(--color-paper)", opacity: 0 },
  dusk: { colour: "var(--color-clay)", opacity: 0.16 },
};

export function daylightAt(date: Date): Daylight {
  const hour = hourOf(date);
  const phase = phaseFor(hour);

  // 0 at sunrise, 1 at sunset, clamped outside those hours.
  const sunProgress = Math.min(1, Math.max(0, (hour - SUNRISE) / (SUNSET - SUNRISE)));

  // Shadows are shortest at solar noon and stretch toward both horizons.
  const fromNoon = Math.abs(sunProgress - 0.5) * 2;
  const shadowScale = phase === "night" ? 1 : 1 + fromNoon * 2;

  return {
    phase,
    skyTop: SKY[phase].top,
    skyBottom: SKY[phase].bottom,
    lampsOn: phase === "night" || phase === "dusk",
    shadowScale: Math.round(shadowScale * 100) / 100,
    sunProgress: Math.round(sunProgress * 1000) / 1000,
    ambientTint: TINT[phase].colour,
    ambientOpacity: TINT[phase].opacity,
  };
}

/**
 * Ambient events, scheduled rather than random-per-frame.
 *
 * Returning intervals rather than firing them keeps this module pure and lets
 * the caller stop everything when the tab is hidden or motion is reduced.
 */
export const AMBIENT = {
  /** A bird crosses the sky about this often. */
  birdEveryMs: 40_000,
  /** Water shimmer, four frames. */
  waterFrameMs: 420,
  waterFrames: 4,
  /** Chimney smoke puff cadence. */
  smokeEveryMs: 2_600,
} as const;
