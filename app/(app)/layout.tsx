import Link from "next/link";
import { getCurrentCity } from "@/lib/queries";
import { CommandPalette } from "@/components/command-palette";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const city = await getCurrentCity();

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b-2 border-ink bg-snow px-4 py-3">
        <div className="flex items-baseline gap-3">
          <Link href="/city" className="font-display text-xl text-ink">
            Burg
          </Link>
          {city ? <span className="font-pixel text-xs uppercase text-stone">{city.name}</span> : null}
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
          <span className="hidden font-pixel text-[10px] uppercase text-stone sm:inline">⌘K</span>
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      {city ? <CommandPalette cityId={city.id} /> : null}
    </div>
  );
}
