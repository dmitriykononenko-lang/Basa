import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "./types";

export type CurrentTeam = {
  team: { id: string; name: string; base_currency: string };
  role: AppRole;
};

// Текущая команда пользователя (пока — первая по дате вступления).
export async function getCurrentTeam(): Promise<CurrentTeam | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select("role, teams(id, name, base_currency)")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data || !data.teams) return null;

  const row = data as unknown as {
    role: AppRole;
    teams: { id: string; name: string; base_currency: string };
  };
  return { team: row.teams, role: row.role };
}

export function canEditFinance(role: AppRole): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

export function canWriteTx(role: AppRole): boolean {
  return canEditFinance(role) || role === "employee";
}

export function canManageTeam(role: AppRole): boolean {
  return role === "owner" || role === "admin";
}
