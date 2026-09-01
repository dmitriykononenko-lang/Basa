import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import AddProjectForm from "@/components/AddProjectForm";
import ProjectsView, { type ProjectFull } from "@/components/ProjectsView";

export default async function ProjectsPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Проекты
        </h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const { team, role } = current;
  const supabase = await createClient();

  const [{ data: items }, { data: employees }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, start_date, plan_work_days, due_date, completed_on, responsible_counterparty_id, manager_counterparty_id, bonus_amount, bonus_currency")
      .eq("team_id", team.id)
      .eq("archived", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("counterparties")
      .select("id, name")
      .eq("team_id", team.id)
      .contains("kinds", ["employee"])
      .eq("archived", false)
      .order("name"),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const projects = (items ?? []) as ProjectFull[];

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Проекты
          </h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Разрез финансов и долгов по проектам
          </p>
        </div>
        {canEditFinance(role) && (
          <AddProjectForm teamId={team.id} employees={employees ?? []} baseCurrency={team.base_currency} />
        )}
      </header>

      <ProjectsView projects={projects} today={today} employees={employees ?? []} />
    </div>
  );
}
