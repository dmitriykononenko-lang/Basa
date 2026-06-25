import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { KB_STATUS_LABELS, kbStatusBadgeClass } from "@/lib/kb";
import { courseProgressPercent } from "@/lib/academy";

export default async function AcademyPage() {
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
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;

  // Мои назначенные курсы (прогресс по элементам)
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
    ? await supabase.from("academy_courses").select("id, title, status").in("id", myCourseIds)
    : { data: [] as { id: string; title: string; status: string }[] };
  const myCourses = (myCoursesData ?? []) as { id: string; title: string; status: string }[];

  // Управление (менеджер+): все курсы команды + число элементов
  let manageCourses: { id: string; title: string; status: keyof typeof KB_STATUS_LABELS; items: number }[] = [];
  if (canManage) {
    const [{ data: courses }, { data: items }] = await Promise.all([
      supabase.from("academy_courses").select("id, title, status").eq("team_id", team.id).order("updated_at", { ascending: false }),
      supabase.from("academy_course_items").select("course_id").eq("team_id", team.id),
    ]);
    const counts = new Map<string, number>();
    for (const it of (items ?? []) as { course_id: string }[]) counts.set(it.course_id, (counts.get(it.course_id) ?? 0) + 1);
    manageCourses = ((courses ?? []) as { id: string; title: string; status: keyof typeof KB_STATUS_LABELS }[]).map((c) => ({
      ...c,
      items: counts.get(c.id) ?? 0,
    }));
  }

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Академия</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">Курсы обучения на основе базы знаний</p>
        </div>
        {canManage && (
          <Link href="/academy/new" className="btn-primary">+ Создать курс</Link>
        )}
      </header>

      {/* Мои курсы */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Мои курсы</h2>
      {myCourses.length > 0 ? (
        <ul className="mb-8 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {myCourses.map((c) => {
            const e = byCourse.get(c.id) ?? { done: 0, total: 0 };
            const pct = courseProgressPercent(e.done, e.total);
            return (
              <li key={c.id}>
                <Link href={`/academy/${c.id}`} className="surface block rounded-3xl p-5 transition hover:ring-brand/40">
                  <h3 className="font-semibold text-slate-900 dark:text-white">{c.title}</h3>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-neutral-400">
                    Пройдено {e.done} из {e.total} ({pct}%)
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mb-8 rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Вам пока не назначены курсы.
        </p>
      )}

      {/* Управление */}
      {canManage && (
        <>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Управление курсами</h2>
          {manageCourses.length > 0 ? (
            <ul className="surface divide-y divide-slate-100 overflow-hidden rounded-3xl dark:divide-white/[0.07]">
              {manageCourses.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-800 dark:text-neutral-200">{c.title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${kbStatusBadgeClass(c.status)}`}>
                        {KB_STATUS_LABELS[c.status]}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400">{c.items} материалов</span>
                  </div>
                  <Link href={`/academy/${c.id}/edit`} className="text-sm text-slate-400 hover:text-brand">
                    Настроить
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Курсов пока нет.</p>
          )}
        </>
      )}
    </div>
  );
}
