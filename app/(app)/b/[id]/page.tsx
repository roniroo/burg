import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BUILDING_NOUN } from "@/lib/queries";

/**
 * The interior shell. Every building type lands here; the body is dispatched
 * on artifact_type. Interiors fetch on the server and stay calm -- once the
 * user is working, the game gets out of the way.
 */
export default async function BuildingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: building } = await supabase
    .from("buildings")
    .select("*, neighborhoods(name, slug, biome, status)")
    .eq("id", id)
    .maybeSingle();

  if (!building) notFound();

  const hood = building.neighborhoods;

  return (
    <article
      data-biome={hood?.biome}
      data-status={hood?.status}
      className="mx-auto max-w-3xl p-6"
    >
      <nav aria-label="Breadcrumb" className="font-pixel text-[10px] uppercase text-stone">
        <Link href="/city">City</Link>
        {hood ? (
          <>
            {" / "}
            <Link href={`/n/${hood.slug}`}>{hood.name}</Link>
          </>
        ) : null}
      </nav>

      <h1 className="mt-2 font-display text-3xl">{building.title}</h1>
      <p className="font-pixel text-[10px] uppercase text-stone">
        {BUILDING_NOUN[building.artifact_type]}
      </p>

      <div className="prose-readable mt-6 border-2 border-ink bg-snow p-6 shadow-hard">
        <p className="font-body text-sm text-stone">
          This interior is a shell. The {BUILDING_NOUN[building.artifact_type].toLowerCase()} editor
          arrives in a later phase.
        </p>
      </div>
    </article>
  );
}
