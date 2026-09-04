import type { Database } from "@/lib/database.types";

export type MapBuilding = Pick<
  Database["public"]["Tables"]["buildings"]["Row"],
  | "id"
  | "title"
  | "artifact_type"
  | "sprite_key"
  | "sprite_variant"
  | "tile_x"
  | "tile_y"
  | "footprint_w"
  | "footprint_h"
  | "floors"
  | "neighborhood_id"
>;

export type MapNeighborhood = Pick<
  Database["public"]["Tables"]["neighborhoods"]["Row"],
  "id" | "name" | "slug" | "biome" | "status" | "origin_x" | "origin_y" | "width" | "height"
>;

export type MapTile = Pick<
  Database["public"]["Tables"]["tiles"]["Row"],
  "x" | "y" | "terrain" | "neighborhood_id"
>;
