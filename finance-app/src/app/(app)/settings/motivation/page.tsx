import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import ProjectBonusTiers, { type Tier } from "@/components/ProjectBonusTiers";

export default async function MotivationSettingsPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Мотивация</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }
  const { team, role } = current;
  const supabase = await createClient();
  const { data: tiers } = await supabase
    .from("project_bonus_tiers")
    .select("id, max_overrun_wd, percent")
    .eq("team_id", team.id)
    .order("max_overrun_wd", { ascending: true });

  return (
    <div className="p-6 sm:p-8">
      <Link href="/settings" className="text-sm text-slate-400 hover:text-brand">← Настройки</Link>
      <header className="mb-6 mt-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Мотивация по проектам</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Бонус аналитику за сдачу проекта снижается ступенчато при просрочке срока внедрения (в рабочих днях)
        </p>
      </header>

      <div className="max-w-2xl">
        <ProjectBonusTiers teamId={team.id} tiers={(tiers ?? []) as Tier[]} canEdit={canEditFinance(role)} />
      </div>
    </div>
  );
}
