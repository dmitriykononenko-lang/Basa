// Серверный гард: редирект, если роль не видит ресурс. Держим отдельно от
// visibility.ts, чтобы клиентские компоненты не тянули серверные импорты.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import { loadVisibility, canView, type VisResource } from "@/lib/visibility";

export async function ensureVisible(resource: VisResource, redirectTo = "/dashboard") {
  const current = await getCurrentTeam();
  if (!current) redirect("/login");
  const supabase = await createClient();
  const map = await loadVisibility(supabase, current.team.id);
  if (!canView(current.role, resource, map)) redirect(redirectTo);
}
