import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import AddProjectForm from "@/components/AddProjectForm";

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

  const { data: items } = await supabase
    .from("projects")
    .select("id, name, status")
    .eq("team_id", team.id)
    .eq("archived", false)
    .order("created_at", { ascending: false });

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
        {canEditFinance(role) && <AddProjectForm teamId={team.id} />}
      </header>

      {items && items.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 transition hover:ring-brand/40 dark:bg-neutral-900 dark:ring-neutral-800 dark:hover:ring-brand/50"
            >
              <div className="text-sm font-medium text-slate-800 dark:text-neutral-200">
                {p.name}
              </div>
              <div className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
                {p.status === "active" ? "Активный" : p.status}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:text-neutral-400 dark:ring-neutral-800">
          Пока нет проектов.
          {canEditFinance(role)
            ? " Добавьте первый кнопкой выше."
            : " Их может добавить владелец или менеджер."}
        </p>
      )}
    </div>
  );
}
