import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BUILDING_GLYPH } from "@/lib/artifacts";

/**
 * What connects to this building, in both directions.
 *
 * The map draws these as roads; this is the same information reachable from
 * the keyboard, and it is the interior's half of the Connections panel.
 */
export async function Backlinks({ buildingId }: { buildingId: string }) {
  const supabase = await createClient();

  const [{ data: outgoing }, { data: incoming }] = await Promise.all([
    supabase
      .from("building_links")
      .select("id, link_type, buildings!building_links_target_building_id_fkey(id, title, artifact_type)")
      .eq("source_building_id", buildingId),
    supabase
      .from("building_links")
      .select("id, link_type, buildings!building_links_source_building_id_fkey(id, title, artifact_type)")
      .eq("target_building_id", buildingId),
  ]);

  const rows = [
    ...(outgoing ?? []).map((r) => ({ id: r.id, direction: "to" as const, other: r.buildings, type: r.link_type })),
    ...(incoming ?? []).map((r) => ({ id: r.id, direction: "from" as const, other: r.buildings, type: r.link_type })),
  ].filter((r) => r.other);

  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="connections-heading" className="mt-10 border-t-2 border-ink pt-4">
      <h2 id="connections-heading" className="font-pixel text-[10px] uppercase text-stone">
        Connections
      </h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {rows.map((row) => (
          <li key={`${row.direction}-${row.id}`}>
            <Link
              href={`/b/${row.other!.id}`}
              className="flex items-center gap-1 border-2 border-ink bg-snow px-2 py-1 font-body text-xs shadow-hard"
            >
              <span aria-hidden className="font-pixel">
                {row.direction === "to" ? "→" : "←"}
              </span>
              <span aria-hidden>{BUILDING_GLYPH[row.other!.artifact_type]}</span>
              <span>{row.other!.title}</span>
              <span className="font-pixel text-[10px] uppercase text-stone">{row.type}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
