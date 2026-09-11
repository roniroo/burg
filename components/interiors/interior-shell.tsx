import Link from "next/link";
import { BUILDING_GLYPH, BUILDING_NOUN, type ArtifactType } from "@/lib/artifacts";
import { DemolishBuilding } from "@/components/city/demolish-button";

/**
 * Shared chrome for every building interior.
 *
 * Interiors are the one place the game gets out of the way: readable type, no
 * ambient motion, a calm single column. The pixel face is confined to the
 * breadcrumb and the type label.
 */
export function InteriorShell({
  buildingId,
  title,
  artifactType,
  neighborhood,
  toolbar,
  children,
  wide = false,
  canEdit = true,
}: {
  buildingId: string;
  title: string;
  artifactType: ArtifactType;
  neighborhood: { name: string; slug: string; biome: string; status: string } | null;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
  /** Viewers read an interior; they do not demolish it. */
  canEdit?: boolean;
}) {
  return (
    <div
      data-biome={neighborhood?.biome}
      data-status={neighborhood?.status}
      className="mx-auto w-full px-6 py-6"
      style={{ maxWidth: wide ? "100%" : "48rem" }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <nav aria-label="Breadcrumb" className="font-pixel text-[10px] uppercase text-stone">
          <Link href="/city" className="underline decoration-mist underline-offset-4">
            City
          </Link>
          {neighborhood ? (
            <>
              <span aria-hidden> / </span>
              <Link
                href={`/n/${neighborhood.slug}`}
                className="underline decoration-mist underline-offset-4"
              >
                {neighborhood.name}
              </Link>
            </>
          ) : null}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          {/* Demolition lives up here with the breadcrumb rather than at the
              foot of the page: it is chrome about the building, not part of
              whatever is being edited inside it. */}
          {canEdit ? (
            <DemolishBuilding buildingId={buildingId} title={title} redirectTo="/city" />
          ) : null}
        </div>
      </div>

      <header className="mt-3 border-b-2 border-ink pb-3">
        <p className="font-pixel text-[10px] uppercase text-stone">
          <span aria-hidden className="mr-1">
            {BUILDING_GLYPH[artifactType]}
          </span>
          {BUILDING_NOUN[artifactType]}
        </p>
        <h1 className="font-display text-3xl leading-tight">{title}</h1>
      </header>

      <div className="mt-6">{children}</div>
    </div>
  );
}
