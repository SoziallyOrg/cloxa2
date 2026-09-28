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
            foreignKeyName: "clock_events_correction_fkey";
            columns: ["organization_id", "correction_id"];
            isOneToOne: false;
            referencedRelation: "correction_requests";
            referencedColumns: ["organization_id", "id"];
          },
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
      correction_requests: {
        Row: {
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
          employee_id: string;
          id: string;
          kind: string;
          organization_id: string;
          proposed: Json;
          reason: string;
          requested_by: string;
          status: string;
          target_event_ids: string[];
        };
        Insert: {
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          employee_id: string;
          id?: string;
          kind: string;
          organization_id: string;
          proposed?: Json;
          reason: string;
          requested_by: string;
          status?: string;
          target_event_ids?: string[];
        };
        Update: {
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          employee_id?: string;
          id?: string;
          kind?: string;
          organization_id?: string;
          proposed?: Json;
          reason?: string;
          requested_by?: string;
          status?: string;
          target_event_ids?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "correction_requests_employee_fkey";
            columns: ["organization_id", "employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "correction_requests_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
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
      invitations: {
        Row: {
          created_at: string;
          email: string;
          employee_id: string;
          expires_at: string;
          id: string;
          invited_by: string;
          membership_id: string | null;
          organization_id: string;
          role: string;
          site_ids: string[];
          status: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          employee_id: string;
          expires_at?: string;
          id?: string;
          invited_by: string;
          membership_id?: string | null;
          organization_id: string;
          role: string;
          site_ids?: string[];
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          employee_id?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          membership_id?: string | null;
          organization_id?: string;
          role?: string;
          site_ids?: string[];
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_employee_fkey";
            columns: ["organization_id", "employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "invitations_membership_fkey";
            columns: ["organization_id", "membership_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "invitations_organization_id_fkey";
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
      schedules: {
        Row: {
          created_at: string;
          created_by: string;
          employee_id: string;
          id: string;
          notified_at: string | null;
          organization_id: string;
          pattern: Json;
          valid_from: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          employee_id: string;
          id?: string;
          notified_at?: string | null;
          organization_id: string;
          pattern: Json;
          valid_from: string;
          version: number;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          employee_id?: string;
          id?: string;
          notified_at?: string | null;
          organization_id?: string;
          pattern?: Json;
          valid_from?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "schedules_employee_fkey";
            columns: ["organization_id", "employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "schedules_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
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
      rpc_accept_membership: {
        Args: never;
        Returns: {
          membership_id: string;
          organization_id: string;
        }[];
      };
      rpc_admin_create_organization: {
        Args: {
          p_name: string;
          p_owner_display_name?: string;
          p_owner_user_id: string;
        };
        Returns: {
          employee_id: string;
          membership_id: string;
          organization_id: string;
          site_id: string;
        }[];
      };
      rpc_auth_attempt:
        | {
            Args: { p_email_hash: string; p_ip_hash?: string; p_kind: string };
            Returns: {
              allowed: boolean;
              retry_after: number;
            }[];
          }
        | {
            Args: {
              p_email_hash: string;
              p_ip_hash: string;
              p_kind: string;
              p_subject_hash: string;
            };
            Returns: {
              allowed: boolean;
              retry_after: number;
            }[];
          };
      rpc_auth_attempt_reset: {
        Args: { p_email_hash: string };
        Returns: undefined;
      };
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
      rpc_decide_correction: {
        Args: { p_decision: string; p_id: string; p_note?: string };
        Returns: {
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
          employee_id: string;
          id: string;
          kind: string;
          organization_id: string;
          proposed: Json;
          reason: string;
          requested_by: string;
          status: string;
          target_event_ids: string[];
        };
        SetofOptions: {
          from: "*";
          to: "correction_requests";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      rpc_invite_member: {
        Args: {
          p_display_name: string;
          p_email: string;
          p_employee_code?: string;
          p_language?: string;
          p_org: string;
          p_role: string;
          p_site_ids: string[];
          p_statute?: string;
        };
        Returns: string;
      };
      rpc_link_invited_user: {
        Args: { p_invitation_id: string; p_user_id: string };
        Returns: string;
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
      rpc_request_correction: {
        Args: {
          p_kind: string;
          p_proposed: Json;
          p_reason: string;
          p_target_event_ids: string[];
        };
        Returns: {
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
          employee_id: string;
          id: string;
          kind: string;
          organization_id: string;
          proposed: Json;
          reason: string;
          requested_by: string;
          status: string;
          target_event_ids: string[];
        };
        SetofOptions: {
          from: "*";
          to: "correction_requests";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      rpc_revoke_invitation: { Args: { p_id: string }; Returns: undefined };
      rpc_schedule_for: {
        Args: { p_employee_id: string; p_from: string; p_to: string };
        Returns: {
          day: string;
          end_at: string;
          start_at: string;
        }[];
      };
      rpc_set_schedule: {
        Args: { p_employee_id: string; p_pattern: Json; p_valid_from: string };
        Returns: {
          created_at: string;
          created_by: string;
          employee_id: string;
          id: string;
          notified_at: string | null;
          organization_id: string;
          pattern: Json;
          valid_from: string;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "schedules";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      rpc_sign_out_everywhere: {
        Args: { p_employee_id: string };
        Returns: number;
      };
      rpc_verify_chains: {
        Args: { p_org: string };
        Returns: {
          audit_broken_row_id: string;
          clock_broken_event_id: string;
        }[];
      };
      rpc_withdraw_correction: {
        Args: { p_id: string };
        Returns: {
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
          employee_id: string;
          id: string;
          kind: string;
          organization_id: string;
          proposed: Json;
          reason: string;
          requested_by: string;
          status: string;
          target_event_ids: string[];
        };
        SetofOptions: {
          from: "*";
          to: "correction_requests";
          isOneToOne: true;
          isSetofReturn: false;
        };
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
