import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { KB_STATUS_LABELS, kbStatusBadgeClass } from "@/lib/kb";
import { courseProgressPercent, dueStatus, DUE_LABELS, dueBadgeClass } from "@/lib/academy";
import EmptyState from "@/components/EmptyState";

export default async function AcademyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; f?: string }>;
}) {
  const { tab: tabRaw, f } = await searchParams;
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Академия</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }
  const { team, role } = current;
  const canManage = canEditFinance(role);
  const tab = canManage && tabRaw === "manage" ? "manage" : "my";
  const filter = f === "active" || f === "done" ? f : "all";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;

  // мой прогресс
  const { data: prog } = await supabase
    .from("academy_progress")
    .select("course_id, status")
    .eq("user_id", uid ?? "");
  const byCourse = new Map<string, { done: number; total: number }>();
  for (const p of (prog ?? []) as { course_id: string; status: string }[]) {
    const e = byCourse.get(p.course_id) ?? { done: 0, total: 0 };
    e.total += 1;
    if (p.status === "done") e.done += 1;
    byCourse.set(p.course_id, e);
  }
  const myCourseIds = [...byCourse.keys()];
  const { data: myCoursesData } = myCourseIds.length
    ? await supabase.from("academy_courses").select("id, title").in("id", myCourseIds)
    : { data: [] as { id: string; title: string }[] };
  const myCourses = (myCoursesData ?? []) as { id: string; title: string }[];

  // дедлайны
  const today = new Date().toISOString().slice(0, 10);
  const { data: myDeptRows } = await supabase.from("kb_user_departments").select("department_id").eq("user_id", uid ?? "");
  const myDeptIds = new Set(((myDeptRows ?? []) as { department_id: string }[]).map((d) => d.department_id));
  const { data: assigns } = myCourseIds.length
    ? await supabase.from("academy_assignments").select("course_id, assignee_type, department_id, user_id, due_date").eq("team_id", team.id).in("course_id", myCourseIds)
    : { data: [] as { course_id: string; assignee_type: string; department_id: string | null; user_id: string | null; due_date: string | null }[] };
  const dueByCourse = new Map<string, string>();
  for (const a of (assigns ?? []) as { course_id: string; assignee_type: string; department_id: string | null; user_id: string | null; due_date: string | null }[]) {
    const applies = (a.assignee_type === "user" && a.user_id === uid) || (a.assignee_type === "department" && a.department_id && myDeptIds.has(a.department_id));
    if (!applies || !a.due_date) continue;
    const cur = dueByCourse.get(a.course_id);
    if (!cur || a.due_date < cur) dueByCourse.set(a.course_id, a.due_date);
  }

  // управление
  let manageCourses: { id: string; title: string; status: keyof typeof KB_STATUS_LABELS; items: number }[] = [];
  if (canManage) {
    const [{ data: courses }, { data: items }] = await Promise.all([
      supabase.from("academy_courses").select("id, title, status").eq("team_id", team.id).order("updated_at", { ascending: false }),
      supabase.from("academy_course_items").select("course_id").eq("team_id", team.id),
    ]);
    const counts = new Map<string, number>();
    for (const it of (items ?? []) as { course_id: string }[]) counts.set(it.course_id, (counts.get(it.course_id) ?? 0) + 1);
    manageCourses = ((courses ?? []) as { id: string; title: string; status: keyof typeof KB_STATUS_LABELS }[]).map((c) => ({ ...c, items: counts.get(c.id) ?? 0 }));
  }

  const myView = myCourses
    .map((c) => {
      const e = byCourse.get(c.id) ?? { done: 0, total: 0 };
      const pct = courseProgressPercent(e.done, e.total);
      const allDone = e.total > 0 && e.done === e.total;
      return { ...c, done: e.done, total: e.total, pct, allDone, due: dueByCourse.get(c.id) ?? null };
    })
    .filter((c) => (filter === "done" ? c.allDone : filter === "active" ? !c.allDone : true));

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Академия</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">Курсы обучения на основе базы знаний</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Link href="/reports/academy" className="btn-ghost">Отчёт</Link>
            <Link href="/academy/new" className="btn-primary">+ Создать курс</Link>
          </div>
        )}
      </header>

      {/* вкладки */}
      {canManage && (
        <div className="mb-5 inline-flex rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
          <Tab href="/academy?tab=my" active={tab === "my"}>Мои курсы</Tab>
          <Tab href="/academy?tab=manage" active={tab === "manage"}>Управление</Tab>
        </div>
      )}

      {tab === "my" ? (
        <>
          {myCourses.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <FilterPill href="/academy" active={filter === "all"}>Все</FilterPill>
              <FilterPill href="/academy?f=active" active={filter === "active"}>В процессе</FilterPill>
              <FilterPill href="/academy?f=done" active={filter === "done"}>Пройденные</FilterPill>
            </div>
          )}
          {myView.length > 0 ? (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {myView.map((c) => {
                const ds = dueStatus(c.due, c.allDone, today);
                return (
                  <li key={c.id}>
                    <Link href={`/academy/${c.id}`} className="surface group flex h-full flex-col rounded-3xl p-5 transition hover:ring-brand/40">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-slate-900 transition group-hover:text-brand dark:text-white">{c.title}</h3>
                        {c.allDone ? (
                          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">✓ Пройдено</span>
                        ) : ds ? (
                          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${dueBadgeClass(ds)}`}>{DUE_LABELS[ds]}</span>
                        ) : null}
                      </div>
                      <div className="mt-auto pt-4">
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
                          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${c.pct}%` }} />
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500 dark:text-neutral-400">
                          <span>Пройдено {c.done} из {c.total}</span>
                          <span className="font-medium">{c.pct}%</span>
                        </div>
                        {c.due && !c.allDone && <div className="mt-1 text-[11px] text-slate-400">срок до {c.due}</div>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon="🎓" title={filter === "all" ? "Вам пока не назначены курсы" : "Нет курсов в этой категории"} description={filter === "all" ? "Назначенные курсы появятся здесь." : undefined} />
          )}
        </>
      ) : (
        <>
          {manageCourses.length > 0 ? (
            <ul className="surface divide-y divide-slate-100 overflow-hidden rounded-3xl dark:divide-white/[0.07]">
              {manageCourses.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-800 dark:text-neutral-200">{c.title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${kbStatusBadgeClass(c.status)}`}>{KB_STATUS_LABELS[c.status]}</span>
                    </div>
                    <span className="text-xs text-slate-400">{c.items} материалов</span>
                  </div>
                  <Link href={`/academy/${c.id}/edit`} className="btn-ghost text-sm">Настроить</Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="📘" title="Курсов пока нет" description="Соберите первый курс из материалов базы знаний." ctaLabel="+ Создать курс" ctaHref="/academy/new" />
          )}
        </>
      )}
    </div>
  );
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`rounded-full px-4 py-1.5 font-medium transition ${active ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}>
      {children}
    </Link>
  );
}
function FilterPill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`rounded-full border px-3 py-1.5 text-sm transition ${active ? "border-brand bg-brand/5 text-brand" : "border-slate-200 text-slate-500 hover:border-slate-300 dark:border-white/10 dark:text-neutral-400"}`}>
      {children}
    </Link>
  );
}
