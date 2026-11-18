import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { periodStart, achievement, type Metric, type MetricValue } from "@/lib/metrics";
import { IconEmployees, IconChart, IconAcademy, IconReports } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function CompanyOsPage() {
  const current = await getCurrentTeam();
  if (!current) redirect("/dashboard");
  if (!canEditFinance(current.role)) redirect("/dashboard");
  const { team } = current;
  const supabase = await createClient();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const [{ data: emps }, { data: invs }, { data: metrics }, { data: mvals }, { data: prog }, { data: assigns }] =
    await Promise.all([
      supabase.from("counterparties").select("id, unit_id, user_id").eq("team_id", team.id).contains("kinds", ["employee"]).eq("archived", false),
      supabase.from("invites").select("id").eq("team_id", team.id).eq("status", "pending"),
      supabase.from("metrics").select("id, name, owner_user_id, period, direction, plan, is_active").eq("team_id", team.id).eq("is_active", true),
      supabase.from("metric_values").select("metric_id, period_start, value").eq("team_id", team.id),
      supabase.from("academy_progress").select("course_id, user_id, status").eq("team_id", team.id),
      supabase.from("academy_assignments").select("course_id, due_date").eq("team_id", team.id),
    ]);

  // ---- Оргструктура / доступы ----
  const employees = (emps ?? []) as { id: string; unit_id: string | null; user_id: string | null }[];
  const empTotal = employees.length;
  const withAccess = employees.filter((e) => e.user_id).length;
  const withoutAccess = empTotal - withAccess;
  const withoutUnit = employees.filter((e) => !e.unit_id).length;
  const pendingInvites = (invs ?? []).length;

  // ---- Показатели ----
  const mets = (metrics ?? []) as Pick<Metric, "id" | "name" | "owner_user_id" | "period" | "direction" | "plan">[];
  const valsByMetric = new Map<string, MetricValue[]>();
  for (const v of (mvals ?? []) as MetricValue[]) {
    const arr = valsByMetric.get(v.metric_id) ?? [];
    arr.push(v);
    valsByMetric.set(v.metric_id, arr);
  }
  let belowPlan = 0;
  const notFilled: string[] = [];
  for (const m of mets) {
    const vals = (valsByMetric.get(m.id) ?? []).slice().sort((a, b) => a.period_start.localeCompare(b.period_start));
    const latest = vals.length ? vals[vals.length - 1].value : null;
    const curPS = periodStart(today, m.period);
    const hasCurrent = vals.some((v) => v.period_start === curPS);
    if (m.plan != null && achievement(latest, m.plan, m.direction).good === false) belowPlan += 1;
    if (m.owner_user_id && !hasCurrent) notFilled.push(m.name);
  }

  // ---- Обучение ----
  const progRows = (prog ?? []) as { course_id: string; user_id: string; status: string }[];
  const doneItems = progRows.filter((p) => p.status === "done").length;
  const totalItems = progRows.length;
  const coverage = totalItems ? Math.round((100 * doneItems) / totalItems) : 0;
  const learners = new Set(progRows.map((p) => p.user_id)).size;
  // просрочено: (сотрудник, курс) с ненулевым незавершённым прогрессом по курсу, чьё назначение просрочено
  const dueByCourse = new Map<string, string>();
  for (const a of (assigns ?? []) as { course_id: string; due_date: string | null }[]) {
    if (!a.due_date) continue;
    const cur = dueByCourse.get(a.course_id);
    if (!cur || a.due_date < cur) dueByCourse.set(a.course_id, a.due_date);
  }
  const byUserCourse = new Map<string, { total: number; done: number }>();
  for (const p of progRows) {
    const k = `${p.user_id}::${p.course_id}`;
    const e = byUserCourse.get(k) ?? { total: 0, done: 0 };
    e.total += 1;
    if (p.status === "done") e.done += 1;
    byUserCourse.set(k, e);
  }
  let overdue = 0;
  for (const [k, e] of byUserCourse) {
    const courseId = k.split("::")[1];
    const due = dueByCourse.get(courseId);
    if (due && due < todayStr && e.done < e.total) overdue += 1;
  }

  // ---- Что требует внимания ----
  const attention: { text: string; href: string }[] = [];
  if (withoutAccess > 0) attention.push({ text: `${withoutAccess} сотр. без входа в систему`, href: "/employees?tab=org" });
  if (pendingInvites > 0) attention.push({ text: `${pendingInvites} приглаш. ждут входа`, href: "/employees?tab=org" });
  if (withoutUnit > 0) attention.push({ text: `${withoutUnit} сотр. без узла оргструктуры`, href: "/employees?tab=org" });
  if (belowPlan > 0) attention.push({ text: `${belowPlan} показателей ниже плана`, href: "/metrics" });
  if (notFilled.length > 0) attention.push({ text: `${notFilled.length} показателей не заполнены за период`, href: "/metrics" });
  if (overdue > 0) attention.push({ text: `${overdue} просроченных обучений`, href: "/academy" });

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">ОС компании</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          {team.name} · сводка по команде, показателям и обучению
        </p>
      </header>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi Icon={IconEmployees} label="Сотрудники" value={String(empTotal)} sub={`${withAccess} с доступом · ${withoutAccess} без`} href="/employees?tab=org" />
        <Kpi Icon={IconChart} label="Показатели" value={String(mets.length)} sub={belowPlan > 0 ? `${belowPlan} ниже плана` : "все в норме"} tone={belowPlan > 0 ? "warn" : "ok"} href="/metrics" />
        <Kpi Icon={IconAcademy} label="Обучение" value={`${coverage}%`} sub={overdue > 0 ? `${overdue} просрочено` : `${learners} учатся`} tone={overdue > 0 ? "warn" : "ok"} href="/academy" />
        <Kpi Icon={IconReports} label="Аналитика" value="→" sub="отчёты и дашборды" href="/reports/team" />
      </div>

      {/* Что требует внимания */}
      <section className="surface mt-4 rounded-3xl p-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Что требует внимания</h2>
        {attention.length > 0 ? (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {attention.map((a, i) => (
              <li key={i}>
                <Link href={a.href} className="flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 transition hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  {a.text}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500 dark:text-neutral-400">Всё в порядке — открытых вопросов нет 🎉</p>
        )}
      </section>

      {/* Разделы */}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <NavCard Icon={IconEmployees} title="Оргструктура" desc="Дерево, доступы, приглашения" href="/employees?tab=org" />
        <NavCard Icon={IconChart} title="Показатели" desc="План/факт по периодам" href="/metrics" />
        <NavCard Icon={IconAcademy} title="Обучение" desc="Курсы и охват" href="/academy" />
        <NavCard Icon={IconReports} title="Аналитика команды" desc="Охват, пробелы, роли" href="/reports/team" />
      </div>
    </div>
  );
}

function Kpi({
  Icon,
  label,
  value,
  sub,
  href,
  tone = "neutral",
}: {
  Icon: (p: { className?: string }) => JSX.Element;
  label: string;
  value: string;
  sub: string;
  href: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  const subCls = tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-neutral-500";
  return (
    <Link href={href} className="surface flex flex-col rounded-3xl p-5 transition hover:ring-brand/40">
      <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-brand/10 text-brand">
        <Icon className="h-5 w-5" />
      </span>
      <span className="mt-3 text-2xl font-extrabold text-slate-900 dark:text-white">{value}</span>
      <span className="text-xs font-medium text-slate-500 dark:text-neutral-400">{label}</span>
      <span className={`mt-0.5 text-xs ${subCls}`}>{sub}</span>
    </Link>
  );
}

function NavCard({
  Icon,
  title,
  desc,
  href,
}: {
  Icon: (p: { className?: string }) => JSX.Element;
  title: string;
  desc: string;
  href: string;
}) {
  return (
    <Link href={href} className="surface group flex items-start gap-3 rounded-3xl p-5 transition hover:ring-brand/40">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 transition group-hover:bg-brand/10 group-hover:text-brand dark:bg-neutral-800 dark:text-neutral-300">
        <Icon className="h-5 w-5" />
      </span>
      <span>
        <span className="block font-semibold text-slate-900 group-hover:text-brand dark:text-white">{title}</span>
        <span className="block text-xs text-slate-400 dark:text-neutral-500">{desc}</span>
      </span>
    </Link>
  );
}
