import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import DepartmentManager from "@/components/kb/DepartmentManager";
import type { KbDepartment } from "@/lib/kb";

export default async function DepartmentsPage() {
  const current = await getCurrentTeam();
  if (!current) redirect("/knowledge-base");
  const { team, role } = current;
  if (!canEditFinance(role)) redirect("/knowledge-base");

  const supabase = await createClient();
  const { data: depts } = await supabase
    .from("kb_departments")
    .select("id, team_id, name, parent_id")
    .eq("team_id", team.id)
    .order("name");

  const departments = (depts ?? []) as KbDepartment[];

  return (
    <div className="p-6 sm:p-8">
      <Link href="/knowledge-base" className="text-sm text-slate-400 hover:text-brand">
        ← База знаний
      </Link>
      <h1 className="mb-6 mt-2 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Отделы</h1>

      <div className="space-y-8">
        <DepartmentManager teamId={team.id} departments={departments} />
        <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:bg-white/[0.03] dark:text-neutral-400">
          Распределение сотрудников по узлам и назначение курсов на отдел теперь живут в{" "}
          <Link href="/employees?tab=org" className="font-medium text-brand hover:underline">Сотрудники → Оргструктура</Link>.
          Курс, назначенный на узел, автоматически разворачивается на сотрудников этого узла и его подразделений (у кого есть доступ в систему).
        </p>
      </div>
    </div>
  );
}
