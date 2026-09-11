import Link from "next/link";
import {
  BUILDING_GLYPH,
  BUILDING_NOUN,
  getCityPeople,
  getCityRole,
  getCityTree,
  getConnections,
  getCurrentCity,
} from "@/lib/queries";
import { DemolishBuilding, DissolveDistrict } from "@/components/city/demolish-button";
import { StartFresh } from "@/components/city/start-fresh";
import { People } from "@/components/city/people";

export const metadata = { title: "Directory — Burg" };

/**
 * The accessible path. Everything the map can do, this page can do: reach any
 * artifact, read the link graph, and be driven entirely from the keyboard.
 * It is deliberately plain and fast -- no sprites, no camera, no animation.
 */
export default async function DirectoryPage() {
  const city = await getCurrentCity();
  if (!city) {
    return <p className="p-8 font-body text-sm text-stone">No city yet.</p>;
  }

  const [tree, connections, role, { people, invites }] = await Promise.all([
    getCityTree(city.id),
    getConnections(city.id),
    getCityRole(city.id),
    getCityPeople(city.id),
  ]);
  if (!tree) return null;

  // A viewer sees everything and changes nothing, so the controls that would
  // only fail at the database are not rendered at all.
  const canEdit = role === "owner" || role === "editor";

  const crossings = connections.filter((c) => c.crossesNeighborhoods).length;
  const buildingCount = tree.neighborhoods.reduce((n, hood) => n + hood.buildings.length, 0);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="font-display text-3xl">Directory</h1>
      <p className="mt-1 font-body text-sm text-stone">
        Every neighbourhood, building and connection in {tree.city.name}.
      </p>

      <section aria-labelledby="places" className="mt-8">
        <h2 id="places" className="font-display text-xl">
          Places
        </h2>

        <ul className="mt-3 flex flex-col gap-4">
          {tree.neighborhoods.map((n) => (
            <li key={n.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-lg">
                  <Link href={`/n/${n.slug}`}>{n.name}</Link>{" "}
                  <span className="font-pixel text-[10px] uppercase text-stone">
                    {n.biome} · {n.status}
                  </span>
                </h3>
                {canEdit ? (
                  <DissolveDistrict
                    neighborhoodId={n.id}
                    name={n.name}
                    buildingCount={n.buildings.length}
                  />
                ) : null}
              </div>
              {n.buildings.length === 0 ? (
                <p className="pl-4 font-body text-sm text-stone">No buildings yet.</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1 border-l-2 border-mist pl-4">
                  {n.buildings.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center gap-2 font-body text-sm">
                      <Link href={`/b/${b.id}`} className="underline decoration-mist underline-offset-4">
                        <span aria-hidden className="mr-2 font-pixel">
                          {BUILDING_GLYPH[b.artifact_type]}
                        </span>
                        {BUILDING_NOUN[b.artifact_type]}: {b.title}
                      </Link>
                      <span className="font-pixel text-[10px] uppercase text-stone">
                        tile {b.tile_x},{b.tile_y}
                      </span>
                      {canEdit ? (
                        <span className="ml-auto">
                          <DemolishBuilding buildingId={b.id} title={b.title} />
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="connections" className="mt-10">
        <h2 id="connections" className="font-display text-xl">
          Connections
        </h2>
        <p className="mt-1 font-body text-sm text-stone">
          {connections.length} links, {crossings} of them crossing neighbourhoods.
        </p>

        <div className="mt-3 overflow-x-auto border-2 border-ink">
          <table className="w-full border-collapse font-body text-sm">
            <caption className="sr-only">
              Every link between buildings, with the neighbourhoods each end sits in.
            </caption>
            <thead className="bg-mist">
              <tr>
                <th scope="col" className="border-b-2 border-ink px-3 py-2 text-left font-pixel text-[10px] uppercase">
                  From
                </th>
                <th scope="col" className="border-b-2 border-ink px-3 py-2 text-left font-pixel text-[10px] uppercase">
                  To
                </th>
                <th scope="col" className="border-b-2 border-ink px-3 py-2 text-left font-pixel text-[10px] uppercase">
                  Type
                </th>
                <th scope="col" className="border-b-2 border-ink px-3 py-2 text-left font-pixel text-[10px] uppercase">
                  Scope
                </th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.id} className="odd:bg-paper even:bg-snow">
                  <td className="border-b border-mist px-3 py-2">
                    <Link href={`/b/${c.source.id}`} className="underline decoration-mist underline-offset-4">
                      {c.source.title}
                    </Link>
                    <span className="block font-pixel text-[10px] uppercase text-stone">
                      {c.source.neighborhood}
                    </span>
                  </td>
                  <td className="border-b border-mist px-3 py-2">
                    <Link href={`/b/${c.target.id}`} className="underline decoration-mist underline-offset-4">
                      {c.target.title}
                    </Link>
                    <span className="block font-pixel text-[10px] uppercase text-stone">
                      {c.target.neighborhood}
                    </span>
                  </td>
                  <td className="border-b border-mist px-3 py-2 font-pixel text-[10px] uppercase">
                    {c.linkType}
                  </td>
                  <td className="border-b border-mist px-3 py-2 font-pixel text-[10px] uppercase">
                    {c.crossesNeighborhoods ? "Highway" : "Street"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <People
        cityId={city.id}
        cityName={tree.city.name}
        role={role ?? "viewer"}
        people={people}
        invites={invites}
      />

      {role === "owner" ? (
      <section aria-labelledby="start-fresh" className="mt-10 mb-6">
        <h2 id="start-fresh" className="font-display text-xl text-brick">
          Start fresh
        </h2>
        <p className="mt-1 font-body text-sm text-stone">
          Clears {tree.city.name} in one go. Every document, table, board, canvas and link inside a
          demolished building goes with it, and none of it comes back.
        </p>
        <StartFresh
          cityId={tree.city.id}
          cityName={tree.city.name}
          buildingCount={buildingCount}
          neighborhoodCount={tree.neighborhoods.length}
        />
      </section>
      ) : null}
    </div>
  );
}
