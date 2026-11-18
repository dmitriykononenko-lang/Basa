import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { unitAncestors } from "@/lib/academy";
import { achievement, periodStart, addPeriods, type MetricPeriod, type MetricDirection } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export default async function TeamReportPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Аналитика команды</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }
  const { team, role } = current;
  if (!canEditFinance(role)) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Аналитика команды</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Раздел доступен менеджерам и владельцам.</p>
      </div>
    );
  }
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();

  const [
    { data: cps },
    { data: members },
    { data: units },
    { data: prog },
    { data: assigns },
    { data: metrics },
    { data: mvals },
  ] = await Promise.all([
    supabase.from("counterparties").select("id, name, user_id, unit_id").eq("team_id", team.id).eq("archived", false).contains("kinds", ["employee"]),
    supabase.from("team_members").select("user_id, role").eq("team_id", team.id),
    supabase.from("kb_departments").select("id, name, parent_id").eq("team_id", team.id),
    supabase.from("academy_progress").select("course_id, user_id, status").eq("team_id", team.id),
    supabase.from("academy_assignments").select("course_id, assignee_type, department_id, user_id, due_date").eq("team_id", team.id),
    supabase.from("metrics").select("id, period, direction, plan, is_active").eq("team_id", team.id).eq("is_active", true),
    supabase.from("metric_values").select("metric_id, period_start, value").eq("team_id", team.id),
  ]);

  // ── Доступы ──
  const employees = (cps ?? []) as { id: string; name: string; user_id: string | null; unit_id: string | null }[];
  const totalEmp = employees.length;
  const withAccount = employees.filter((e) => e.user_id).length;
  const noAccount = employees.filter((e) => !e.user_id);
  const noUnit = employees.filter((e) => !e.unit_id);

  // ── Роли ──
  const roleCounts = new Map<AppRole, number>();
  for (const m of (members ?? []) as { role: AppRole }[]) roleCounts.set(m.role, (roleCounts.get(m.role) ?? 0) + 1);

  // ── Обучение ──
  const parentOf = new Map(((units ?? []) as { id: string; parent_id: string | null }[]).map((u) => [u.id, u.parent_id]));
  const unitOfUser = new Map<string, string | null>();
  for (const e of employees) if (e.user_id) unitOfUser.set(e.user_id, e.unit_id);

  const byUserCourse = new Map<string, { done: number; total: number }>();
  for (const p of (prog ?? []) as { course_id: string; user_id: string; status: string }[]) {
    const k = `${p.user_id}|${p.course_id}`;
    const e = byUserCourse.get(k) ?? { done: 0, total: 0 };
    e.total += 1;
    if (p.status === "done") e.done += 1;
    byUserCourse.set(k, e);
  }
  const assignRows = (assigns ?? []) as { course_id: string; assignee_type: string; department_id: string | null; user_id: string | null; due_date: string | null }[];
  let assignedCourses = 0, completedCourses = 0, overdueCourses = 0, doneItems = 0, totalItems = 0;
  for (const [k, e] of byUserCourse) {
    assignedCourses += 1;
    doneItems += e.done;
    totalItems += e.total;
    const allDone = e.total > 0 && e.done === e.total;
    if (allDone) { completedCourses += 1; continue; }
    const [uid, courseId] = k.split("|");
    const myUnits = unitAncestors(unitOfUser.get(uid) ?? null, parentOf);
    let due: string | null = null;
    for (const a of assignRows) {
      if (a.course_id !== courseId || !a.due_date) continue;
      const applies = (a.assignee_type === "user" && a.user_id === uid) || (a.assignee_type === "department" && a.department_id && myUnits.has(a.department_id));
      if (applies && (!due || a.due_date < due)) due = a.due_date;
    }
    if (due && due < today) overdueCourses += 1;
  }
  const itemPct = totalItems > 0 ? Math.round((100 * doneItems) / totalItems) : 0;

  // ── Показатели ──
  const vmap = new Map<string, number>();
  for (const v of (mvals ?? []) as { metric_id: string; period_start: string; value: number }[]) vmap.set(`${v.metric_id}|${v.period_start}`, Number(v.value));
  const metricRows = (metrics ?? []) as { id: string; period: MetricPeriod; direction: MetricDirection; plan: number | null }[];
  let mWithPlan = 0, mOnTrack = 0, mBelow = 0, mMissing = 0;
  for (const m of metricRows) {
    const curStart = periodStart(now, m.period);
    const lastClosed = addPeriods(curStart, m.period, -1);
    if (!vmap.has(`${m.id}|${lastClosed}`)) mMissing += 1;
    if (m.plan != null) {
      mWithPlan += 1;
      const cur = vmap.has(`${m.id}|${curStart}`) ? vmap.get(`${m.id}|${curStart}`)! : (vmap.has(`${m.id}|${lastClosed}`) ? vmap.get(`${m.id}|${lastClosed}`)! : null);
      const { good } = achievement(cur, m.plan, m.direction);
      if (good) mOnTrack += 1; else mBelow += 1;
    }
  }

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Аналитика команды</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">Доступы, роли, обучение и показатели — здоровье оргструктуры</p>
      </header>

      {/* Доступы */}
      <Section title="Доступы">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Сотрудников" value={totalEmp} />
          <Kpi label="С учёткой" value={withAccount} accent="text-emerald-600 dark:text-emerald-400" />
          <Kpi label="Без учётки" value={noAccount.length} accent={noAccount.length ? "text-amber-600 dark:text-amber-400" : ""} />
          <Kpi label="Без узла" value={noUnit.length} accent={noUnit.length ? "text-amber-600 dark:text-amber-400" : ""} />
        </div>
        {(noAccount.length > 0 || noUnit.length > 0) && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {noAccount.length > 0 && (
              <GapList title="Нет учётки (не получат обучение/уведомления)" names={noAccount.map((e) => e.name)} />
            )}
            {noUnit.length > 0 && (
              <GapList title="Не привязаны к узлу оргструктуры" names={noUnit.map((e) => e.name)} />
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400 dark:text-neutral-500">Привязать учётку и узел — в разделе «Сотрудники → Оргструктура».</p>
      </Section>

      {/* Роли */}
      <Section title="Роли">
        <div className="flex flex-wrap gap-2">
          {(["owner", "admin", "manager", "employee", "viewer"] as AppRole[]).map((r) => (
            <span key={r} className="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
              {ROLE_LABELS[r]}: <b className="text-slate-900 dark:text-white">{roleCounts.get(r) ?? 0}</b>
            </span>
          ))}
        </div>
      </Section>

      {/* Обучение */}
      <Section title="Обучение">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Назначено курсов" value={assignedCourses} />
          <Kpi label="Завершено" value={completedCourses} accent="text-emerald-600 dark:text-emerald-400" />
          <Kpi label="Просрочено" value={overdueCourses} accent={overdueCourses ? "text-red-600 dark:text-red-400" : ""} />
          <Kpi label="Материалов пройдено" value={`${itemPct}%`} />
        </div>
        <Link href="/reports/academy" className="mt-3 inline-block text-sm text-brand hover:underline">Подробный отчёт по обучению →</Link>
      </Section>

      {/* Показатели */}
      <Section title="Показатели">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="С планом" value={mWithPlan} />
          <Kpi label="В плане" value={mOnTrack} accent="text-emerald-600 dark:text-emerald-400" />
          <Kpi label="Ниже плана" value={mBelow} accent={mBelow ? "text-amber-600 dark:text-amber-400" : ""} />
          <Kpi label="Не заполнено" value={mMissing} accent={mMissing ? "text-amber-600 dark:text-amber-400" : ""} />
        </div>
        <Link href="/metrics" className="mt-3 inline-block text-sm text-brand hover:underline">Открыть показатели →</Link>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface mb-4 rounded-3xl p-6">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">{title}</h2>
      {children}
    </section>
  );
}

function Kpi({ label, value, accent = "" }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4 dark:bg-white/[0.03]">
      <div className="text-xs text-slate-400 dark:text-neutral-500">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold ${accent || "text-slate-900 dark:text-white"}`}>{value}</div>
    </div>
  );
}

function GapList({ title, names }: { title: string; names: string[] }) {
  return (
    <div className="rounded-2xl bg-amber-50/60 p-4 ring-1 ring-amber-200/60 dark:bg-amber-950/20 dark:ring-amber-900/30">
      <div className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-300">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {names.slice(0, 30).map((n, i) => (
          <span key={i} className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-amber-200/60 dark:bg-neutral-900 dark:text-neutral-300 dark:ring-amber-900/30">{n}</span>
        ))}
        {names.length > 30 && <span className="text-xs text-slate-400">+{names.length - 30}</span>}
      </div>
    </div>
  );
}
