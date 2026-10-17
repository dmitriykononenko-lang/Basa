import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canManageTeam } from "@/lib/team";
import { loadVisibility, VIS_RESOURCES, CONFIGURABLE_ROLES } from "@/lib/visibility";
import type { AppRole } from "@/lib/types";
import VisibilitySettings from "@/components/settings/VisibilitySettings";

export const dynamic = "force-dynamic";

export default async function VisibilitySettingsPage() {
  const current = await getCurrentTeam();
  if (!current) redirect("/dashboard");
  if (!canManageTeam(current.role)) redirect("/settings");

  const supabase = await createClient();
  const map = await loadVisibility(supabase, current.team.id);

  const initial: Record<string, AppRole[]> = {};
  for (const r of VIS_RESOURCES) {
    // из сохранённого убираем owner (он всегда), оставляем настраиваемые
    const saved = map[r.key];
    initial[r.key] = saved ? saved.filter((role) => CONFIGURABLE_ROLES.includes(role)) : [...CONFIGURABLE_ROLES];
  }

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-8">
      <Link href="/settings" className="text-sm text-slate-400 hover:text-brand">← Настройки</Link>
      <header className="mb-6 mt-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Шаблоны видимости по ролям</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          Что видит каждая роль по умолчанию. Индивидуально для сотрудника можно переопределить в{" "}
          <Link href="/team" className="text-brand hover:underline">Участники и роли</Link> → карточка сотрудника.
        </p>
      </header>
      <VisibilitySettings teamId={current.team.id} initial={initial} />
    </div>
  );
}
