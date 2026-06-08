import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import AddProjectForm from "@/components/AddProjectForm";
import { effectiveDue, businessDaysBetween, workdaysLabel } from "@/lib/workdays";

type Project = {
  id: string;
  name: string;
  status: string;
  start_date: string;
  plan_work_days: number | null;
  due_date: string | null;
  completed_on: string | null;
};

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
      .select("id, name, status, start_date, plan_work_days, due_date, completed_on")
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
  const projects = (items ?? []) as Project[];

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

      {projects.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 transition hover:ring-brand/40 dark:bg-[#15171c] dark:ring-white/[0.07] dark:hover:ring-brand/50"
            >
              <div className="line-clamp-2 break-words text-sm font-medium text-slate-800 dark:text-neutral-200">
                {p.name}
              </div>
              <div className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
                {p.status === "active" ? "Активный" : p.status === "done" ? "Сдан" : p.status}
              </div>
              <DeadlineLine p={p} today={today} />
            </Link>
          ))}
        </div>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Пока нет проектов.
          {canEditFinance(role)
            ? " Добавьте первый кнопкой выше."
            : " Их может добавить владелец или менеджер."}
        </p>
      )}
    </div>
  );
}

function DeadlineLine({ p, today }: { p: Project; today: string }) {
  if (p.status === "done") {
    return (
      <div className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        ✓ Сдан{p.completed_on ? ` ${new Date(p.completed_on).toLocaleDateString("ru-RU")}` : ""}
      </div>
    );
  }
  if (p.status !== "active") return null;

  const eff = effectiveDue(p.start_date, p.plan_work_days, p.due_date);
  const elapsed = businessDaysBetween(p.start_date, today);
  let tail: React.ReactNode = null;
  if (eff) {
    if (today > eff) {
      const over = businessDaysBetween(eff, today);
      tail = <span className="font-medium text-red-600 dark:text-red-400"> · просрочка {workdaysLabel(over)}</span>;
    } else {
      const left = businessDaysBetween(today, eff);
      tail = <span className="text-slate-500 dark:text-neutral-400"> · до срока {workdaysLabel(left)}</span>;
    }
  }
  return (
    <div className="mt-2 text-xs text-slate-400 dark:text-neutral-500">
      идёт {workdaysLabel(elapsed)}
      {tail}
    </div>
  );
}
