import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import DepartmentManager from "@/components/kb/DepartmentManager";
import MemberDepartments from "@/components/kb/MemberDepartments";
import type { KbDepartment } from "@/lib/kb";

export default async function DepartmentsPage() {
  const current = await getCurrentTeam();
  if (!current) redirect("/knowledge-base");
  const { team, role } = current;
  if (!canEditFinance(role)) redirect("/knowledge-base");

  const supabase = await createClient();
  const [{ data: depts }, { data: membersRaw }, { data: mappings }] = await Promise.all([
    supabase.from("kb_departments").select("id, team_id, name, parent_id").eq("team_id", team.id).order("name"),
    supabase.from("team_members").select("user_id, profiles(full_name)").eq("team_id", team.id),
    supabase.from("kb_user_departments").select("department_id, user_id").eq("team_id", team.id),
  ]);

  const departments = (depts ?? []) as KbDepartment[];
  const members = ((membersRaw ?? []) as { user_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[]).map((m) => ({
    id: m.user_id,
    name: (Array.isArray(m.profiles) ? m.profiles[0]?.full_name : m.profiles?.full_name) || "Без имени",
  }));

  return (
    <div className="p-6 sm:p-8">
      <Link href="/knowledge-base" className="text-sm text-slate-400 hover:text-brand">
        ← База знаний
      </Link>
      <h1 className="mb-6 mt-2 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Отделы</h1>

      <div className="space-y-8">
        <DepartmentManager teamId={team.id} departments={departments} />
        {departments.length > 0 && (
          <MemberDepartments
            teamId={team.id}
            departments={departments.map((d) => ({ id: d.id, name: d.name }))}
            members={members}
            mappings={(mappings ?? []) as { department_id: string; user_id: string }[]}
          />
        )}
      </div>
    </div>
  );
}
