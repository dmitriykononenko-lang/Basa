import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import CourseEditor, { type CourseEditorData } from "@/components/academy/CourseEditor";
import AssignmentPanel from "@/components/academy/AssignmentPanel";
import { courseProgressPercent, type AcademyAssigneeType } from "@/lib/academy";
import type { KbKind, KbStatus } from "@/lib/kb";

export default async function CourseEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await getCurrentTeam();
  if (!current) redirect("/academy");
  const { team, role } = current;
  if (!canEditFinance(role)) redirect("/academy");
  const supabase = await createClient();

  const { data: course } = await supabase
    .from("academy_courses")
    .select("id, title, status, description")
    .eq("id", id)
    .maybeSingle();
  if (!course) notFound();
  const c = course as { id: string; title: string; status: KbStatus; description: string };

  const [{ data: items }, { data: articles }, { data: membersRaw }, { data: depts }, { data: assignmentsRaw }, { data: progress }, { data: userDepts }] =
    await Promise.all([
      supabase.from("academy_course_items").select("article_id, position").eq("course_id", id).order("position"),
      supabase.from("kb_articles").select("id, title, kind").eq("team_id", team.id).order("title"),
      supabase.from("team_members").select("user_id, profiles(full_name)").eq("team_id", team.id),
      supabase.from("kb_departments").select("id, name").eq("team_id", team.id).order("name"),
      supabase.from("academy_assignments").select("id, assignee_type, department_id, user_id, due_date").eq("course_id", id),
      supabase.from("academy_progress").select("user_id, status").eq("course_id", id),
      supabase.from("kb_user_departments").select("department_id, user_id").eq("team_id", team.id),
    ]);

  const members = ((membersRaw ?? []) as { user_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[]).map((m) => ({
    id: m.user_id,
    name: (Array.isArray(m.profiles) ? m.profiles[0]?.full_name : m.profiles?.full_name) || "Без имени",
  }));
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const departments = ((depts ?? []) as { id: string; name: string }[]);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));

  const initial: CourseEditorData = {
    id: c.id,
    title: c.title,
    status: c.status,
    description: c.description,
    itemArticleIds: ((items ?? []) as { article_id: string }[]).map((i) => i.article_id),
  };

  const assignments = ((assignmentsRaw ?? []) as {
    id: string;
    assignee_type: AcademyAssigneeType;
    department_id: string | null;
    user_id: string | null;
    due_date: string | null;
  }[]).map((a) => ({
    id: a.id,
    assignee_type: a.assignee_type,
    due_date: a.due_date,
    label: a.assignee_type === "user" ? memberName.get(a.user_id ?? "") ?? "—" : deptName.get(a.department_id ?? "") ?? "—",
  }));

  // отделы каждого сотрудника (для вычисления срока по department-назначениям)
  const today = new Date().toISOString().slice(0, 10);
  const deptsOfUser = new Map<string, Set<string>>();
  for (const ud of (userDepts ?? []) as { department_id: string; user_id: string }[]) {
    const s = deptsOfUser.get(ud.user_id) ?? new Set<string>();
    s.add(ud.department_id);
    deptsOfUser.set(ud.user_id, s);
  }
  const rawAssigns = (assignmentsRaw ?? []) as {
    assignee_type: AcademyAssigneeType;
    department_id: string | null;
    user_id: string | null;
    due_date: string | null;
  }[];
  function dueForUser(uid: string): string | null {
    let best: string | null = null;
    for (const a of rawAssigns) {
      const applies =
        (a.assignee_type === "user" && a.user_id === uid) ||
        (a.assignee_type === "department" && a.department_id && deptsOfUser.get(uid)?.has(a.department_id));
      if (!applies || !a.due_date) continue;
      if (!best || a.due_date < best) best = a.due_date;
    }
    return best;
  }

  // дашборд прогресса: агрегат по пользователям
  const agg = new Map<string, { done: number; total: number }>();
  for (const p of (progress ?? []) as { user_id: string; status: string }[]) {
    const e = agg.get(p.user_id) ?? { done: 0, total: 0 };
    e.total += 1;
    if (p.status === "done") e.done += 1;
    agg.set(p.user_id, e);
  }
  const rows = [...agg.entries()].map(([uid, e]) => {
    const pct = courseProgressPercent(e.done, e.total);
    const due = dueForUser(uid);
    return {
      name: memberName.get(uid) ?? "—",
      done: e.done,
      total: e.total,
      pct,
      due,
      overdue: !!due && pct < 100 && due < today,
    };
  });

  // KPI
  const kpiAssigned = agg.size;
  const kpiCompleted = rows.filter((r) => r.total > 0 && r.done === r.total).length;
  let kpiDone = 0;
  let kpiTotal = 0;
  for (const e of agg.values()) {
    kpiDone += e.done;
    kpiTotal += e.total;
  }
  const kpiAvg = courseProgressPercent(kpiDone, kpiTotal);

  return (
    <div className="space-y-8 p-6 sm:p-8">
      <div>
        <Link href="/academy" className="text-sm text-slate-400 hover:text-brand">← Академия</Link>
        <h1 className="mb-6 mt-2 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Настройка курса</h1>
        <CourseEditor teamId={team.id} articles={(articles ?? []) as { id: string; title: string; kind: KbKind }[]} initial={initial} />
      </div>

      <AssignmentPanel teamId={team.id} courseId={id} members={members} departments={departments} assignments={assignments} />

      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Назначено" value={kpiAssigned} />
        <KpiCard label="Завершили" value={kpiCompleted} accent="emerald" />
        <KpiCard label="Средний прогресс" value={`${kpiAvg}%`} accent="brand" />
      </div>

      <section className="surface rounded-3xl p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Прогресс сотрудников</h2>
        {rows.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="py-2">Сотрудник</th>
                <th className="py-2">Прогресс</th>
                <th className="py-2">Срок</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.07]">
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="py-2 text-slate-800 dark:text-neutral-200">{r.name}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${r.pct}%` }} />
                      </div>
                      <span className="text-xs text-slate-500 dark:text-neutral-400">{r.done}/{r.total} ({r.pct}%)</span>
                    </div>
                  </td>
                  <td className="py-2 text-xs">
                    {r.due ? (
                      <span className={r.overdue ? "font-medium text-red-600 dark:text-red-400" : "text-slate-500 dark:text-neutral-400"}>
                        {r.overdue ? "просрочено · " : "до "}{r.due}
                      </span>
                    ) : (
                      <span className="text-slate-300 dark:text-neutral-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-400">Пока никому не назначено.</p>
        )}
      </section>
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string | number; accent?: "brand" | "emerald" }) {
  const color = accent === "emerald" ? "text-emerald-600 dark:text-emerald-400" : accent === "brand" ? "text-brand" : "text-slate-900 dark:text-white";
  return (
    <div className="surface rounded-3xl p-4">
      <div className="text-xs text-slate-500 dark:text-neutral-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
