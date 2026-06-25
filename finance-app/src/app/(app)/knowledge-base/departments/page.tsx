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
  const { data } = await supabase
    .from("kb_departments")
    .select("id, team_id, name, parent_id")
    .eq("team_id", team.id)
    .order("name");

  return (
    <div className="p-6 sm:p-8">
      <Link href="/knowledge-base" className="text-sm text-slate-400 hover:text-brand">
        ← База знаний
      </Link>
      <h1 className="mb-6 mt-2 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
        Отделы
      </h1>
      <DepartmentManager teamId={team.id} departments={(data ?? []) as KbDepartment[]} />
    </div>
  );
}
