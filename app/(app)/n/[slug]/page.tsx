import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BUILDING_GLYPH, BUILDING_NOUN } from "@/lib/artifacts";
import { RegionForm } from "@/components/map/region-form";

/** Neighbourhood view. Phase 1 replaces the list with a zoomed-in map region. */
export default async function NeighborhoodPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: hood } = await supabase
    .from("neighborhoods")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!hood) notFound();

  const { data: buildings } = await supabase
    .from("buildings")
    .select("*")
    .eq("neighborhood_id", hood.id)
    .order("position");

  return (
    <div data-biome={hood.biome} data-status={hood.status} className="mx-auto max-w-3xl p-6">
      <nav aria-label="Breadcrumb" className="font-pixel text-[10px] uppercase text-stone">
        <Link href="/city">City</Link>
      </nav>

      <h1 className="mt-2 font-display text-3xl">{hood.name}</h1>
      <p className="font-pixel text-[10px] uppercase text-stone">
        {hood.biome} · {hood.status} · {hood.width}×{hood.height} tiles at ({hood.origin_x},{" "}
        {hood.origin_y})
      </p>
      <p className="mt-2 font-body text-sm text-slate">{hood.description}</p>

      <RegionForm
        neighborhoodId={hood.id}
        originX={hood.origin_x}
        originY={hood.origin_y}
        width={hood.width}
        height={hood.height}
      />

      <ul className="mt-6 flex flex-col gap-2">
        {(buildings ?? []).map((b) => (
          <li key={b.id}>
            <Link
              href={`/b/${b.id}`}
              className="flex items-center gap-2 border-2 border-ink bg-snow px-3 py-2 font-body text-sm shadow-hard"
            >
              <span aria-hidden className="font-pixel">
                {BUILDING_GLYPH[b.artifact_type]}
              </span>
              {b.title}
              <span className="ml-auto font-pixel text-[10px] uppercase text-stone">
                {BUILDING_NOUN[b.artifact_type]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
