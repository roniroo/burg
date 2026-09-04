"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * Whether the user has asked for reduced motion.
 *
 * Hand-rolled rather than motion's `useReducedMotion` because that one
 * reported `false` in a reduce-motion browser here, which silently kept the
 * JS animation branches alive -- including the timed delay before navigating
 * into a building. CSS clamps transitions, but it cannot clamp a setTimeout,
 * so this value has to be right.
 *
 * `useSyncExternalStore` keeps the server snapshot (`false`) and the client
 * snapshot consistent through hydration, then re-renders on the real value.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (typeof window === "undefined" ? false : window.matchMedia(QUERY).matches),
    () => false,
  );
}
