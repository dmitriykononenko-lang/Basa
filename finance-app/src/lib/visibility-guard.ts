// Серверный гард: редирект, если текущий пользователь не видит ресурс.
// Использует can_view_resource (БД) — авторитетный источник: учитывает
// индивидуальные переопределения сотрудника и шаблон роли.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import type { VisResource } from "@/lib/visibility";

export async function ensureVisible(resource: VisResource, redirectTo = "/dashboard") {
  const current = await getCurrentTeam();
  if (!current) redirect("/login");
  const supabase = await createClient();
  const { data } = await supabase.rpc("can_view_resource", {
    _team_id: current.team.id,
    _resource: resource,
  });
  if (data === false) redirect(redirectTo);
}
