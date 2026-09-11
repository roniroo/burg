export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity: {
        Row: {
          actor_id: string | null
          city_id: string
          created_at: string
          headline: string
          id: string
          subject_id: string | null
          subject_type: string
          verb: string
        }
        Insert: {
          actor_id?: string | null
          city_id: string
          created_at?: string
          headline: string
          id?: string
          subject_id?: string | null
          subject_type: string
          verb: string
        }
        Update: {
          actor_id?: string | null
          city_id?: string
          created_at?: string
          headline?: string
          id?: string
          subject_id?: string | null
          subject_type?: string
          verb?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      board_columns: {
        Row: {
          building_id: string
          city_id: string
          color: number
          id: string
          name: string
          position: number
        }
        Insert: {
          building_id: string
          city_id: string
          color?: number
          id?: string
          name: string
          position?: number
        }
        Update: {
          building_id?: string
          city_id?: string
          color?: number
          id?: string
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "board_columns_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "board_columns_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      board_notes: {
        Row: {
          body: string
          body_tsv: unknown
          building_id: string
          city_id: string
          color: number
          column_id: string | null
          created_at: string
          id: string
          pin_x: number
          pin_y: number
          position: number
          rotation: number
        }
        Insert: {
          body?: string
          body_tsv?: unknown
          building_id: string
          city_id: string
          color?: number
          column_id?: string | null
          created_at?: string
          id?: string
          pin_x?: number
          pin_y?: number
          position?: number
          rotation?: number
        }
        Update: {
          body?: string
          body_tsv?: unknown
          building_id?: string
          city_id?: string
          color?: number
          column_id?: string | null
          created_at?: string
          id?: string
          pin_x?: number
          pin_y?: number
          position?: number
          rotation?: number
        }
        Relationships: [
          {
            foreignKeyName: "board_notes_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "board_notes_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_notes_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "board_columns"
            referencedColumns: ["id"]
          },
        ]
      }
      boards: {
        Row: {
          building_id: string
          city_id: string
          mode: Database["public"]["Enums"]["board_mode"]
        }
        Insert: {
          building_id: string
          city_id: string
          mode?: Database["public"]["Enums"]["board_mode"]
        }
        Update: {
          building_id?: string
          city_id?: string
          mode?: Database["public"]["Enums"]["board_mode"]
        }
        Relationships: [
          {
            foreignKeyName: "boards_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boards_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      building_links: {
        Row: {
          city_id: string
          created_at: string
          id: string
          link_type: Database["public"]["Enums"]["link_type"]
          source_building_id: string
          target_building_id: string
        }
        Insert: {
          city_id: string
          created_at?: string
          id?: string
          link_type?: Database["public"]["Enums"]["link_type"]
          source_building_id: string
          target_building_id: string
        }
        Update: {
          city_id?: string
          created_at?: string
          id?: string
          link_type?: Database["public"]["Enums"]["link_type"]
          source_building_id?: string
          target_building_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_links_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_links_source_building_id_fkey"
            columns: ["source_building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_links_target_building_id_fkey"
            columns: ["target_building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      buildings: {
        Row: {
          artifact_type: Database["public"]["Enums"]["artifact_type"]
          city_id: string
          color_variant: number
          created_at: string
          floors: number
          footprint_h: number
          footprint_w: number
          id: string
          is_pinned: boolean
          neighborhood_id: string
          position: number
          sprite_key: string
          sprite_variant: number
          tile_x: number
          tile_y: number
          title: string
          title_tsv: unknown
          updated_at: string
        }
        Insert: {
          artifact_type: Database["public"]["Enums"]["artifact_type"]
          city_id: string
          color_variant?: number
          created_at?: string
          floors?: number
          footprint_h?: number
          footprint_w?: number
          id?: string
          is_pinned?: boolean
          neighborhood_id: string
          position?: number
          sprite_key: string
          sprite_variant?: number
          tile_x: number
          tile_y: number
          title: string
          title_tsv?: unknown
          updated_at?: string
        }
        Update: {
          artifact_type?: Database["public"]["Enums"]["artifact_type"]
          city_id?: string
          color_variant?: number
          created_at?: string
          floors?: number
          footprint_h?: number
          footprint_w?: number
          id?: string
          is_pinned?: boolean
          neighborhood_id?: string
          position?: number
          sprite_key?: string
          sprite_variant?: number
          tile_x?: number
          tile_y?: number
          title?: string
          title_tsv?: unknown
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "buildings_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buildings_neighborhood_id_fkey"
            columns: ["neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["id"]
          },
        ]
      }
      canvases: {
        Row: {
          building_id: string
          city_id: string
          scene: Json
          updated_at: string
        }
        Insert: {
          building_id: string
          city_id: string
          scene?: Json
          updated_at?: string
        }
        Update: {
          building_id?: string
          city_id?: string
          scene?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "canvases_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canvases_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          created_at: string
          height: number
          id: string
          name: string
          owner_id: string
          seed: number
          slug: string
          width: number
        }
        Insert: {
          created_at?: string
          height?: number
          id?: string
          name: string
          owner_id: string
          seed?: number
          slug: string
          width?: number
        }
        Update: {
          created_at?: string
          height?: number
          id?: string
          name?: string
          owner_id?: string
          seed?: number
          slug?: string
          width?: number
        }
        Relationships: []
      }
      city_invites: {
        Row: {
          city_id: string
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["city_role"]
        }
        Insert: {
          city_id: string
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["city_role"]
        }
        Update: {
          city_id?: string
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["city_role"]
        }
        Relationships: [
          {
            foreignKeyName: "city_invites_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      city_members: {
        Row: {
          city_id: string
          role: Database["public"]["Enums"]["city_role"]
          user_id: string
        }
        Insert: {
          city_id: string
          role?: Database["public"]["Enums"]["city_role"]
          user_id: string
        }
        Update: {
          city_id?: string
          role?: Database["public"]["Enums"]["city_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "city_members_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      data_tables: {
        Row: {
          building_id: string
          city_id: string
          name: string
          primary_field_id: string | null
        }
        Insert: {
          building_id: string
          city_id: string
          name?: string
          primary_field_id?: string | null
        }
        Update: {
          building_id?: string
          city_id?: string
          name?: string
          primary_field_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_tables_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_tables_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_tables_primary_field_fk"
            columns: ["primary_field_id"]
            isOneToOne: false
            referencedRelation: "table_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          building_id: string
          city_id: string
          content: Json
          search_text: string
          search_tsv: unknown
          updated_at: string
        }
        Insert: {
          building_id: string
          city_id: string
          content?: Json
          search_text?: string
          search_tsv?: unknown
          updated_at?: string
        }
        Update: {
          building_id?: string
          city_id?: string
          content?: Json
          search_text?: string
          search_tsv?: unknown
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      gates: {
        Row: {
          city_id: string
          edge: Database["public"]["Enums"]["edge_side"]
          edge_offset: number
          id: string
          is_auto: boolean
          neighborhood_id: string
          tile_x: number
          tile_y: number
        }
        Insert: {
          city_id: string
          edge: Database["public"]["Enums"]["edge_side"]
          edge_offset?: number
          id?: string
          is_auto?: boolean
          neighborhood_id: string
          tile_x: number
          tile_y: number
        }
        Update: {
          city_id?: string
          edge?: Database["public"]["Enums"]["edge_side"]
          edge_offset?: number
          id?: string
          is_auto?: boolean
          neighborhood_id?: string
          tile_x?: number
          tile_y?: number
        }
        Relationships: [
          {
            foreignKeyName: "gates_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gates_neighborhood_id_fkey"
            columns: ["neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["id"]
          },
        ]
      }
      kiosk_links: {
        Row: {
          building_id: string
          city_id: string
          id: string
          note: string
          og_image_url: string | null
          position: number
          storage_path: string | null
          title: string
          url: string
        }
        Insert: {
          building_id: string
          city_id: string
          id?: string
          note?: string
          og_image_url?: string | null
          position?: number
          storage_path?: string | null
          title?: string
          url: string
        }
        Update: {
          building_id?: string
          city_id?: string
          id?: string
          note?: string
          og_image_url?: string | null
          position?: number
          storage_path?: string | null
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "kiosk_links_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kiosk_links_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      neighborhoods: {
        Row: {
          biome: Database["public"]["Enums"]["biome"]
          city_id: string
          created_at: string
          crest_sprite: string
          description: string
          height: number
          id: string
          name: string
          name_tsv: unknown
          origin_x: number
          origin_y: number
          position: number
          slug: string
          status: Database["public"]["Enums"]["neighborhood_status"]
          width: number
        }
        Insert: {
          biome?: Database["public"]["Enums"]["biome"]
          city_id: string
          created_at?: string
          crest_sprite?: string
          description?: string
          height: number
          id?: string
          name: string
          name_tsv?: unknown
          origin_x: number
          origin_y: number
          position?: number
          slug: string
          status?: Database["public"]["Enums"]["neighborhood_status"]
          width: number
        }
        Update: {
          biome?: Database["public"]["Enums"]["biome"]
          city_id?: string
          created_at?: string
          crest_sprite?: string
          description?: string
          height?: number
          id?: string
          name?: string
          name_tsv?: unknown
          origin_x?: number
          origin_y?: number
          position?: number
          slug?: string
          status?: Database["public"]["Enums"]["neighborhood_status"]
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "neighborhoods_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_sprite: string
          created_at: string
          display_name: string
          id: string
        }
        Insert: {
          avatar_sprite?: string
          created_at?: string
          display_name?: string
          id: string
        }
        Update: {
          avatar_sprite?: string
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      road_routes: {
        Row: {
          a_building_id: string
          a_gate_id: string | null
          a_neighborhood_id: string | null
          b_building_id: string
          b_gate_id: string | null
          b_neighborhood_id: string | null
          city_id: string
          id: string
          link_count: number
          path: Json
          scope: Database["public"]["Enums"]["road_scope"]
          stale: boolean
          tier: Database["public"]["Enums"]["road_tier"]
          updated_at: string
        }
        Insert: {
          a_building_id: string
          a_gate_id?: string | null
          a_neighborhood_id?: string | null
          b_building_id: string
          b_gate_id?: string | null
          b_neighborhood_id?: string | null
          city_id: string
          id?: string
          link_count?: number
          path?: Json
          scope: Database["public"]["Enums"]["road_scope"]
          stale?: boolean
          tier?: Database["public"]["Enums"]["road_tier"]
          updated_at?: string
        }
        Update: {
          a_building_id?: string
          a_gate_id?: string | null
          a_neighborhood_id?: string | null
          b_building_id?: string
          b_gate_id?: string | null
          b_neighborhood_id?: string | null
          city_id?: string
          id?: string
          link_count?: number
          path?: Json
          scope?: Database["public"]["Enums"]["road_scope"]
          stale?: boolean
          tier?: Database["public"]["Enums"]["road_tier"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "road_routes_a_building_id_fkey"
            columns: ["a_building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "road_routes_a_gate_id_fkey"
            columns: ["a_gate_id"]
            isOneToOne: false
            referencedRelation: "gates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "road_routes_a_neighborhood_id_fkey"
            columns: ["a_neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "road_routes_b_building_id_fkey"
            columns: ["b_building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "road_routes_b_gate_id_fkey"
            columns: ["b_gate_id"]
            isOneToOne: false
            referencedRelation: "gates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "road_routes_b_neighborhood_id_fkey"
            columns: ["b_neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "road_routes_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          current_period_end: string | null
          price_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      table_fields: {
        Row: {
          building_id: string
          city_id: string
          field_type: Database["public"]["Enums"]["field_type"]
          id: string
          name: string
          options: Json
          position: number
          width: number
        }
        Insert: {
          building_id: string
          city_id: string
          field_type?: Database["public"]["Enums"]["field_type"]
          id?: string
          name: string
          options?: Json
          position?: number
          width?: number
        }
        Update: {
          building_id?: string
          city_id?: string
          field_type?: Database["public"]["Enums"]["field_type"]
          id?: string
          name?: string
          options?: Json
          position?: number
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "table_fields_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "data_tables"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "table_fields_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      table_rows: {
        Row: {
          building_id: string
          city_id: string
          created_at: string
          data: Json
          id: string
          position: number
          search_text: string
          search_tsv: unknown
          updated_at: string
        }
        Insert: {
          building_id: string
          city_id: string
          created_at?: string
          data?: Json
          id?: string
          position?: number
          search_text?: string
          search_tsv?: unknown
          updated_at?: string
        }
        Update: {
          building_id?: string
          city_id?: string
          created_at?: string
          data?: Json
          id?: string
          position?: number
          search_text?: string
          search_tsv?: unknown
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_rows_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "data_tables"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "table_rows_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      table_views: {
        Row: {
          building_id: string
          city_id: string
          filters: Json
          group_by_field_id: string | null
          hidden_fields: Json
          id: string
          name: string
          position: number
          sorts: Json
          view_type: Database["public"]["Enums"]["view_type"]
        }
        Insert: {
          building_id: string
          city_id: string
          filters?: Json
          group_by_field_id?: string | null
          hidden_fields?: Json
          id?: string
          name?: string
          position?: number
          sorts?: Json
          view_type?: Database["public"]["Enums"]["view_type"]
        }
        Update: {
          building_id?: string
          city_id?: string
          filters?: Json
          group_by_field_id?: string | null
          hidden_fields?: Json
          id?: string
          name?: string
          position?: number
          sorts?: Json
          view_type?: Database["public"]["Enums"]["view_type"]
        }
        Relationships: [
          {
            foreignKeyName: "table_views_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "data_tables"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "table_views_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_views_group_by_field_id_fkey"
            columns: ["group_by_field_id"]
            isOneToOne: false
            referencedRelation: "table_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      tiles: {
        Row: {
          city_id: string
          neighborhood_id: string | null
          terrain: Database["public"]["Enums"]["terrain"]
          x: number
          y: number
        }
        Insert: {
          city_id: string
          neighborhood_id?: string | null
          terrain?: Database["public"]["Enums"]["terrain"]
          x: number
          y: number
        }
        Update: {
          city_id?: string
          neighborhood_id?: string | null
          terrain?: Database["public"]["Enums"]["terrain"]
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "tiles_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiles_neighborhood_id_fkey"
            columns: ["neighborhood_id"]
            isOneToOne: false
            referencedRelation: "neighborhoods"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      city_is_paid: { Args: { target_city: string }; Returns: boolean }
      search_all: {
        Args: { p_city_id: string; p_query: string }
        Returns: {
          building_id: string
          id: string
          kind: Database["public"]["Enums"]["search_kind"]
          neighborhood_id: string
          rank: number
          snippet: string
          title: string
        }[]
      }
    }
    Enums: {
      artifact_type: "doc" | "table" | "board" | "canvas" | "kiosk"
      biome: "downtown" | "harbor" | "forest" | "desert" | "snow"
      board_mode: "freeform" | "columns"
      city_role: "owner" | "editor" | "viewer"
      edge_side: "north" | "east" | "south" | "west"
      field_type:
        | "text"
        | "long_text"
        | "number"
        | "currency"
        | "select"
        | "multi_select"
        | "date"
        | "checkbox"
        | "url"
        | "person"
        | "relation"
      link_type: "wiki" | "relation" | "promoted_from" | "manual"
      neighborhood_status: "planning" | "building" | "shipped" | "archived"
      road_scope: "street" | "highway"
      road_tier: "dirt" | "cobble" | "paved" | "highway"
      search_kind: "neighborhood" | "building" | "document" | "row" | "note"
      terrain: "grass" | "cobble" | "water" | "park" | "road"
      view_type: "table" | "board" | "gallery"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      artifact_type: ["doc", "table", "board", "canvas", "kiosk"],
      biome: ["downtown", "harbor", "forest", "desert", "snow"],
      board_mode: ["freeform", "columns"],
      city_role: ["owner", "editor", "viewer"],
      edge_side: ["north", "east", "south", "west"],
      field_type: [
        "text",
        "long_text",
        "number",
        "currency",
        "select",
        "multi_select",
        "date",
        "checkbox",
        "url",
        "person",
        "relation",
      ],
      link_type: ["wiki", "relation", "promoted_from", "manual"],
      neighborhood_status: ["planning", "building", "shipped", "archived"],
      road_scope: ["street", "highway"],
      road_tier: ["dirt", "cobble", "paved", "highway"],
      search_kind: ["neighborhood", "building", "document", "row", "note"],
      terrain: ["grass", "cobble", "water", "park", "road"],
      view_type: ["table", "board", "gallery"],
    },
  },
} as const
