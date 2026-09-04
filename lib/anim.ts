"use client";

import { animate, createTimeline, steps, utils } from "animejs";

/**
 * anime.js helpers.
 *
 * Two rules are enforced here rather than left to each call site:
 *
 *   1. Sprite-like motion is STEPPED. Smooth 60fps interpolation on pixel art
 *      reads as wrong -- the eye expects frames -- so anything representing a
 *      sprite uses `steps()` easing.
 *   2. Nothing runs under `prefers-reduced-motion: reduce`. CSS can clamp a
 *      transition, but it cannot clamp a JS timeline, so every entry point
 *      here checks first and resolves immediately instead.
 */

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Frame counts tuned so motion reads as animation cels, not tweens. */
export const STEP_FAST = steps(4);
export const STEP_SPRITE = steps(6);

/** Speeds, from the brief. Ceremonies are the only slow ones; they are rewards. */
export const DURATION = {
  ui: 160,
  camera: 350,
  ceremony: 700,
  ceremonyMax: 900,
} as const;

/**
 * Run a ceremony timeline, or skip it entirely under reduced motion.
 *
 * Always resolves, so callers can `await` it and then commit their change
 * without branching on the motion preference themselves.
 */
export async function ceremony(build: (timeline: ReturnType<typeof createTimeline>) => void): Promise<void> {
  if (prefersReducedMotion()) return;

  const timeline = createTimeline({ defaults: { ease: STEP_SPRITE } });
  build(timeline);

  await new Promise<void>((resolve) => {
    timeline.then(() => resolve());
    // A timeline that somehow never completes must not strand the interaction.
    window.setTimeout(resolve, DURATION.ceremonyMax + 200);
  });
}

/**
 * The note-promotion flight: a note lifts, travels to the signpost, and
 * shrinks into it. Whole pixels only.
 */
export function flyToSignpost(note: HTMLElement, signpost: HTMLElement): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();

  const from = note.getBoundingClientRect();
  const to = signpost.getBoundingClientRect();
  const dx = Math.round(to.left + to.width / 2 - (from.left + from.width / 2));
  const dy = Math.round(to.top + to.height / 2 - (from.top + from.height / 2));

  return new Promise((resolve) => {
    animate(note, {
      translateX: [0, dx],
      translateY: [0, dy],
      scale: [1, 0.2],
      rotate: [0, 12],
      duration: DURATION.ceremony,
      ease: STEP_SPRITE,
      onComplete: () => resolve(),
    });
  });
}

/** Pin a note down: scale up, tilt, then drop with a squash. */
export function pinDown(note: HTMLElement, rotation: number): void {
  if (prefersReducedMotion()) return;

  createTimeline({ defaults: { ease: STEP_FAST } })
    .add(note, { scale: [1, 1.12], rotate: rotation, duration: 90 })
    .add(note, { scaleY: 0.9, scaleX: 1.08, duration: 70 })
    .add(note, { scaleY: 1, scaleX: 1, duration: 90 });
}

/** A construction site assembling in four stepped frames, then a dust puff. */
export function raiseBuilding(scaffold: HTMLElement, dust: HTMLElement): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();

  return new Promise((resolve) => {
    createTimeline({ defaults: { ease: STEP_FAST } })
      .add(scaffold, { opacity: [0, 1], translateY: [8, 0], duration: 120 })
      .add(scaffold, { scaleY: [0.2, 1], duration: 320, ease: STEP_SPRITE })
      .add(dust, { opacity: [0, 1], scale: [0.4, 1.6], duration: 180 }, "-=80")
      .add(dust, { opacity: 0, duration: 120, onComplete: () => resolve() });
  });
}

/** Round a set of elements' transforms to whole pixels after any animation. */
export function snapTransforms(elements: HTMLElement[]): void {
  for (const el of elements) utils.set(el, { translateX: 0, translateY: 0 });
}
