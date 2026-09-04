import Link from "next/link";
import { BUILDING_GLYPH, BUILDING_NOUN, getCityTree, getCurrentCity } from "@/lib/queries";

export const metadata = { title: "City — Burg" };

/**
 * Phase 0 placeholder. Phase 1 replaces this with the isometric map; the
 * region/building data it reads is already the shape the map needs.
 */
export default async function CityPage() {
  const city = await getCurrentCity();
  if (!city) {
    return (
      <p className="p-8 font-body text-sm text-stone">
        No city yet. Sign out and back in to have one founded for you.
      </p>
    );
  }

  const tree = await getCityTree(city.id);
  if (!tree) return null;

  return (
    <div className="p-6">
      <h1 className="font-display text-3xl">{tree.city.name}</h1>
      <p className="mt-1 font-body text-sm text-stone">
        {tree.city.width} × {tree.city.height} tiles · {tree.neighborhoods.length} neighbourhoods
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tree.neighborhoods.map((n) => (
          <section
            key={n.id}
            data-biome={n.biome}
            data-status={n.status}
            className="border-2 border-ink bg-snow p-4 shadow-hard"
          >
            <div
              className="mb-3 h-2 w-full border-b-2 border-ink"
              style={{ backgroundColor: "var(--biome-ground)" }}
            />
            <h2 className="font-display text-xl">{n.name}</h2>
            <p className="font-pixel text-[10px] uppercase text-stone">
              {n.biome} · {n.status}
            </p>
            <p className="mt-2 font-body text-sm text-slate">{n.description}</p>

            <ul className="mt-3 flex flex-col gap-1">
              {n.buildings.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/b/${b.id}`}
                    className="flex items-center gap-2 border-2 border-ink bg-paper px-2 py-1 font-body text-sm text-ink shadow-hard"
                  >
                    <span aria-hidden className="font-pixel">
                      {BUILDING_GLYPH[b.artifact_type]}
                    </span>
                    <span>{b.title}</span>
                    <span className="ml-auto font-pixel text-[10px] uppercase text-stone">
                      {BUILDING_NOUN[b.artifact_type]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
