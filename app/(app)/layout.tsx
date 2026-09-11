import Link from "next/link";
import { getCurrentCity, getReachableCities } from "@/lib/queries";
import { CommandPalette } from "@/components/command-palette";
import { signOut } from "@/lib/actions/auth";
import { SupportLink } from "@/components/support-link";
import { CitySwitcher } from "@/components/city/city-switcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [city, reachable] = await Promise.all([getCurrentCity(), getReachableCities()]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b-2 border-ink bg-snow px-4 py-3">
        <div className="flex items-baseline gap-3">
          <Link href="/city" className="font-display text-xl text-ink">
            Burg
          </Link>
          {city && reachable.length > 1 ? (
            <CitySwitcher
              cities={reachable.map((c) => ({ id: c.id, name: c.name, role: c.role }))}
              activeId={city.id}
            />
          ) : city ? (
            <span className="font-pixel text-xs uppercase text-stone">{city.name}</span>
          ) : null}
        </div>
        <nav aria-label="Primary" className="flex items-center gap-2">
          <Link
            href="/city"
            className="border-2 border-ink bg-paper px-3 py-1 font-pixel text-xs uppercase text-ink shadow-hard"
          >
            Map
          </Link>
          <Link
            href="/directory"
            className="border-2 border-ink bg-paper px-3 py-1 font-pixel text-xs uppercase text-ink shadow-hard"
          >
            Directory
          </Link>
          <Link
            href="/plan"
            className="border-2 border-ink bg-paper px-3 py-1 font-pixel text-xs uppercase text-ink shadow-hard"
          >
            Plan
          </Link>
          <span className="hidden font-pixel text-[10px] uppercase text-stone sm:inline">⌘K</span>
          <SupportLink />
          <form action={signOut}>
            <button
              type="submit"
              data-sign-out
              className="border-2 border-ink bg-paper px-3 py-1 font-pixel text-xs uppercase text-ink shadow-hard"
            >
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      {city ? <CommandPalette cityId={city.id} /> : null}
    </div>
  );
}
