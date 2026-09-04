import { notFound } from "next/navigation";
import type { JSONContent } from "@tiptap/core";
import { createClient } from "@/lib/supabase/server";
import { InteriorShell } from "@/components/interiors/interior-shell";
import { Newsstand } from "@/components/interiors/newsstand";
import { DocEditor, type LinkTarget } from "@/components/interiors/doc-editor";
import { Backlinks } from "@/components/interiors/backlinks";

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

  if (building.artifact_type === "kiosk") {
    const { data: links } = await supabase
      .from("kiosk_links")
      .select("*")
      .eq("building_id", id)
      .order("position");

    return (
      <InteriorShell title={building.title} artifactType="kiosk" neighborhood={hood}>
        <Newsstand buildingId={id} links={links ?? []} />
        <Backlinks buildingId={id} />
      </InteriorShell>
    );
  }

  if (building.artifact_type === "doc") {
    const [{ data: document }, { data: targets }] = await Promise.all([
      supabase.from("documents").select("content").eq("building_id", id).maybeSingle(),
      supabase
        .from("buildings")
        .select("id, title, artifact_type, neighborhoods(name)")
        .eq("city_id", building.city_id)
        .order("title"),
    ]);

    const linkTargets: LinkTarget[] = (targets ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      artifactType: t.artifact_type,
      neighborhood: t.neighborhoods?.name ?? "",
    }));

    return (
      <InteriorShell title={building.title} artifactType="doc" neighborhood={hood}>
        <DocEditor
          buildingId={id}
          initialContent={(document?.content ?? { type: "doc", content: [] }) as JSONContent}
          linkTargets={linkTargets}
        />
        <Backlinks buildingId={id} />
      </InteriorShell>
    );
  }

  return (
    <InteriorShell title={building.title} artifactType={building.artifact_type} neighborhood={hood}>
      <p className="prose-readable font-body text-sm text-stone">
        This interior is not built yet.
      </p>
      <Backlinks buildingId={id} />
    </InteriorShell>
  );
}
