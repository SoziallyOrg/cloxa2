export type Json =
  string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_user_id: string | null;
          created_at: string;
          entity: string;
          entity_id: string | null;
          hash: string;
          id: string;
          metadata: Json;
          organization_id: string;
          prev_hash: string;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          created_at?: string;
          entity: string;
          entity_id?: string | null;
          hash: string;
          id?: string;
          metadata?: Json;
          organization_id: string;
          prev_hash: string;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          created_at?: string;
          entity?: string;
          entity_id?: string | null;
          hash?: string;
          id?: string;
          metadata?: Json;
          organization_id?: string;
          prev_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      clock_events: {
        Row: {
          actor_user_id: string;
          client_captured_at: string | null;
          correction_id: string | null;
          device_id: string | null;
          employee_id: string;
          geo: Json | null;
          hash: string;
          id: string;
          idempotency_key: string;
          occurred_at: string;
          organization_id: string;
          prev_hash: string;
          server_at: string;
          site_id: string;
          source: string;
          supersedes_event_id: string | null;
          type: string;
        };
        Insert: {
          actor_user_id: string;
          client_captured_at?: string | null;
          correction_id?: string | null;
          device_id?: string | null;
          employee_id: string;
          geo?: Json | null;
          hash: string;
          id?: string;
          idempotency_key: string;
          occurred_at: string;
          organization_id: string;
          prev_hash: string;
          server_at?: string;
          site_id: string;
          source: string;
          supersedes_event_id?: string | null;
          type: string;
        };
        Update: {
          actor_user_id?: string;
          client_captured_at?: string | null;
          correction_id?: string | null;
          device_id?: string | null;
          employee_id?: string;
          geo?: Json | null;
          hash?: string;
          id?: string;
          idempotency_key?: string;
          occurred_at?: string;
          organization_id?: string;
          prev_hash?: string;
          server_at?: string;
          site_id?: string;
          source?: string;
          supersedes_event_id?: string | null;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clock_events_employee_fkey";
            columns: ["organization_id", "employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "clock_events_site_fkey";
            columns: ["organization_id", "site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "clock_events_supersedes_fkey";
            columns: ["organization_id", "supersedes_event_id"];
            isOneToOne: false;
            referencedRelation: "clock_events";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      employees: {
        Row: {
          active: boolean;
          created_at: string;
          display_name: string;
          employee_code: string | null;
          id: string;
          language: string;
          organization_id: string;
          statute: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          display_name: string;
          employee_code?: string | null;
          id?: string;
          language?: string;
          organization_id: string;
          statute?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          display_name?: string;
          employee_code?: string | null;
          id?: string;
          language?: string;
          organization_id?: string;
          statute?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "employees_membership_fkey";
            columns: ["organization_id", "user_id"];
            isOneToOne: true;
            referencedRelation: "memberships";
            referencedColumns: ["organization_id", "user_id"];
          },
          {
            foreignKeyName: "employees_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      memberships: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          role: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          role: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          role?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          settings: Json;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          settings?: Json;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          settings?: Json;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      site_assignments: {
        Row: {
          created_at: string;
          employee_id: string | null;
          id: string;
          membership_id: string | null;
          organization_id: string;
          site_id: string;
        };
        Insert: {
          created_at?: string;
          employee_id?: string | null;
          id?: string;
          membership_id?: string | null;
          organization_id: string;
          site_id: string;
        };
        Update: {
          created_at?: string;
          employee_id?: string | null;
          id?: string;
          membership_id?: string | null;
          organization_id?: string;
          site_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "site_assignments_employee_fkey";
            columns: ["organization_id", "employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "site_assignments_membership_fkey";
            columns: ["organization_id", "membership_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "site_assignments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "site_assignments_site_fkey";
            columns: ["organization_id", "site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      sites: {
        Row: {
          active: boolean;
          address: string | null;
          created_at: string;
          id: string;
          name: string;
          organization_id: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          address?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          organization_id: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          address?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          organization_id?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sites_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      rpc_clock: {
        Args: {
          p_client_captured_at?: string;
          p_idempotency_key: string;
          p_site_id: string;
          p_type: string;
        };
        Returns: {
          actor_user_id: string;
          client_captured_at: string | null;
          correction_id: string | null;
          device_id: string | null;
          employee_id: string;
          geo: Json | null;
          hash: string;
          id: string;
          idempotency_key: string;
          occurred_at: string;
          organization_id: string;
          prev_hash: string;
          server_at: string;
          site_id: string;
          source: string;
          supersedes_event_id: string | null;
          type: string;
        };
        SetofOptions: {
          from: "*";
          to: "clock_events";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      rpc_my_status: {
        Args: never;
        Returns: {
          employee_id: string;
          last_event_id: string;
          last_event_occurred_at: string;
          last_event_site_id: string;
          last_event_type: string;
          open_shift_started_at: string;
          organization_id: string;
          state: string;
        }[];
      };
      rpc_verify_chains: {
        Args: { p_org: string };
        Returns: {
          audit_broken_row_id: string;
          clock_broken_event_id: string;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
