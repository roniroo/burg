/**
 * The one place the support URL is written down.
 *
 * Deliberately quiet chrome rather than a fifth hard-shadow button: the header
 * already carries Map, Directory and Sign out, and a donation link that shouts
 * louder than the app's own navigation is asking for something before it has
 * earned it. It sits at the same weight as the ⌘K hint next to it.
 *
 * A plain <a>, not next/link: the destination is off-site, so there is nothing
 * for the router to prefetch, and typedRoutes has no opinion about it.
 */

export const SUPPORT_URL = "https://buymeacoffee.com/veronicalec";

export function SupportLink({
  /** `header` is the compact form; `block` is for pages with room. */
  variant = "header",
}: {
  variant?: "header" | "block";
}) {
  const label = "Buy me a coffee — support Burg";

  if (variant === "block") {
    return (
      <a
        href={SUPPORT_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        className="inline-flex items-center gap-2 border-2 border-ink bg-gold px-3 py-1 font-pixel text-[10px] uppercase text-ink shadow-hard"
      >
        <span aria-hidden>☕</span>
        <span aria-hidden>Buy me a coffee</span>
      </a>
    );
  }

  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="inline-flex items-center gap-1 font-pixel text-[10px] uppercase text-stone underline decoration-mist underline-offset-4 hover:text-ink"
    >
      <span aria-hidden>☕</span>
      {/* The word is dropped on narrow screens; the accessible name is on the
          anchor, so the link never becomes an unlabelled glyph. */}
      <span aria-hidden className="hidden sm:inline">
        Coffee
      </span>
    </a>
  );
}
