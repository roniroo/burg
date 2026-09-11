import Link from "next/link";
import { SupportLink } from "@/components/support-link";

/**
 * Chrome for the legal pages.
 *
 * They sit outside (app) because they are reachable signed out — someone has
 * to be able to read the terms before agreeing to them — so they get their own
 * header rather than the one with Map, Directory and Sign out in it.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink bg-snow px-4 py-3">
        <Link href="/" className="font-display text-xl text-ink">
          Burg
        </Link>
        <nav aria-label="Legal" className="flex items-center gap-3 font-pixel text-[10px] uppercase">
          <Link href="/terms" className="text-stone underline decoration-mist underline-offset-4 hover:text-ink">
            Terms
          </Link>
          <Link href="/privacy" className="text-stone underline decoration-mist underline-offset-4 hover:text-ink">
            Privacy
          </Link>
          <SupportLink />
        </nav>
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 py-10">{children}</main>

      <footer className="mx-auto w-full max-w-2xl px-6 pb-12 font-body text-xs text-stone">
        <Link href="/sign-in" className="underline decoration-mist underline-offset-4">
          Back to Burg
        </Link>
      </footer>
    </div>
  );
}
