import { notFound } from "next/navigation";
import type { JSONContent } from "@tiptap/core";
import { createClient } from "@/lib/supabase/server";
import { InteriorShell } from "@/components/interiors/interior-shell";
import { Newsstand } from "@/components/interiors/newsstand";
import { DocEditor, type LinkTarget } from "@/components/interiors/doc-editor";
import { Warehouse, type View } from "@/components/interiors/warehouse";
import { Noticeboard, type PromoteTarget } from "@/components/interiors/noticeboard";
import { Studio } from "@/components/interiors/studio";
import { parseScene } from "@/lib/canvas/model";
import type { Field, FieldOptions, Filter, Row, Sort } from "@/lib/table/model";
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

  if (building.artifact_type === "table") {
    const [{ data: table }, { data: fieldRows }, { data: rowRows }, { data: viewRows }] = await Promise.all([
      supabase.from("data_tables").select("primary_field_id").eq("building_id", id).maybeSingle(),
      supabase.from("table_fields").select("*").eq("building_id", id).order("position"),
      supabase.from("table_rows").select("id, data, position").eq("building_id", id).order("position"),
      supabase.from("table_views").select("*").eq("building_id", id).order("position"),
    ]);

    const fields: Field[] = (fieldRows ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      field_type: f.field_type,
      options: (f.options ?? {}) as FieldOptions,
      position: f.position,
      width: f.width,
    }));

    const rows: Row[] = (rowRows ?? []).map((r) => ({
      id: r.id,
      data: (r.data ?? {}) as Row["data"],
      position: r.position,
    }));

    const views: View[] = (viewRows ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      view_type: v.view_type,
      filters: (v.filters ?? []) as Filter[],
      sorts: (v.sorts ?? []) as Sort[],
      hidden_fields: (v.hidden_fields ?? []) as string[],
      group_by_field_id: v.group_by_field_id,
    }));

    return (
      <InteriorShell title={building.title} artifactType="table" neighborhood={hood} wide>
        <Warehouse
          buildingId={id}
          fields={fields}
          rows={rows}
          views={views}
          primaryFieldId={table?.primary_field_id ?? null}
        />
        <Backlinks buildingId={id} />
      </InteriorShell>
    );
  }

  if (building.artifact_type === "board") {
    const [{ data: board }, { data: notes }, { data: columns }, { data: targets }] = await Promise.all([
      supabase.from("boards").select("mode").eq("building_id", id).maybeSingle(),
      supabase.from("board_notes").select("*").eq("building_id", id).order("position"),
      supabase.from("board_columns").select("*").eq("building_id", id).order("position"),
      supabase
        .from("buildings")
        .select("id, title, artifact_type")
        .eq("city_id", building.city_id)
        .in("artifact_type", ["table", "board"]),
    ]);

    const promoteTargets: PromoteTarget[] = (targets ?? [])
      .filter((t) => t.id !== id)
      .map((t) => ({ id: t.id, title: t.title, artifactType: t.artifact_type }));

    return (
      <InteriorShell title={building.title} artifactType="board" neighborhood={hood} wide>
        <Noticeboard
          buildingId={id}
          mode={board?.mode ?? "freeform"}
          notes={notes ?? []}
          columns={columns ?? []}
          promoteTargets={promoteTargets}
        />
        <Backlinks buildingId={id} />
      </InteriorShell>
    );
  }

  if (building.artifact_type === "canvas") {
    const { data: canvas } = await supabase
      .from("canvases")
      .select("scene")
      .eq("building_id", id)
      .maybeSingle();

    return (
      <InteriorShell title={building.title} artifactType="canvas" neighborhood={hood} wide>
        <Studio buildingId={id} initialScene={parseScene(canvas?.scene)} />
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
