import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import ExportButton from "@/components/ExportButton";
import { courseProgressPercent, unitAncestors } from "@/lib/academy";

type ProgRow = { course_id: string; user_id: string; status: string };

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 dark:text-neutral-400">{pct}%</span>
    </div>
  );
}

export default async function AcademyReportPage() {
  const current = await getCurrentTeam();
  if (!current) redirect("/academy");
  const { team, role } = current;
  if (!canEditFinance(role)) redirect("/academy");
  const supabase = await createClient();

  const [{ data: courses }, { data: progress }, { data: membersRaw }, { data: depts }, { data: empCps }] =
    await Promise.all([
      supabase.from("academy_courses").select("id, title").eq("team_id", team.id),
      supabase.from("academy_progress").select("course_id, user_id, status").eq("team_id", team.id),
      supabase.from("team_members").select("user_id, profiles(full_name)").eq("team_id", team.id),
      supabase.from("kb_departments").select("id, name, parent_id").eq("team_id", team.id),
      supabase.from("counterparties").select("user_id, unit_id").eq("team_id", team.id).contains("kinds", ["employee"]).eq("archived", false).not("user_id", "is", null),
    ]);

  const courseTitle = new Map(((courses ?? []) as { id: string; title: string }[]).map((c) => [c.id, c.title]));
  const memberName = new Map(
    ((membersRaw ?? []) as { user_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[]).map((m) => [
      m.user_id,
      (Array.isArray(m.profiles) ? m.profiles[0]?.full_name : m.profiles?.full_name) || "Без имени",
    ]),
  );
  const prog = (progress ?? []) as ProgRow[];

  // агрегаты (course,user)
  const cu = new Map<string, { done: number; total: number }>();
  for (const p of prog) {
    const k = `${p.course_id}|${p.user_id}`;
    const e = cu.get(k) ?? { done: 0, total: 0 };
    e.total += 1;
    if (p.status === "done") e.done += 1;
    cu.set(k, e);
  }

  // по курсам
  const byCourse = new Map<string, { done: number; total: number; users: Set<string>; users100: number }>();
  // по сотрудникам
  const byUser = new Map<string, { done: number; total: number }>();
  for (const [k, e] of cu) {
    const [courseId, userId] = k.split("|");
    const bc = byCourse.get(courseId) ?? { done: 0, total: 0, users: new Set<string>(), users100: 0 };
    bc.done += e.done;
    bc.total += e.total;
    bc.users.add(userId);
    if (e.total > 0 && e.done === e.total) bc.users100 += 1;
    byCourse.set(courseId, bc);
    const bu = byUser.get(userId) ?? { done: 0, total: 0 };
    bu.done += e.done;
    bu.total += e.total;
    byUser.set(userId, bu);
  }

  // по отделам (узлам оргструктуры): прогресс сотрудника учитывается в его узле и всех узлах-предках
  const unitTree = (depts ?? []) as { id: string; name: string; parent_id: string | null }[];
  const parentOf = new Map(unitTree.map((d) => [d.id, d.parent_id]));
  const unitOfUser = new Map<string, string | null>();
  for (const cp of (empCps ?? []) as { user_id: string; unit_id: string | null }[]) {
    if (cp.user_id) unitOfUser.set(cp.user_id, cp.unit_id);
  }
  const deptAgg = new Map<string, { done: number; total: number }>();
  for (const [uid, e] of byUser) {
    for (const node of unitAncestors(unitOfUser.get(uid), parentOf)) {
      const acc = deptAgg.get(node) ?? { done: 0, total: 0 };
      acc.done += e.done;
      acc.total += e.total;
      deptAgg.set(node, acc);
    }
  }
  const byDept = unitTree
    .map((d) => {
      const acc = deptAgg.get(d.id) ?? { done: 0, total: 0 };
      return { name: d.name, done: acc.done, total: acc.total, pct: courseProgressPercent(acc.done, acc.total) };
    })
    .filter((r) => r.total > 0);

  // детальные строки для CSV (курс × сотрудник)
  const csvRows: (string | number)[][] = [...cu.entries()].map(([k, e]) => {
    const [courseId, userId] = k.split("|");
    return [
      courseTitle.get(courseId) ?? "—",
      memberName.get(userId) ?? "—",
      e.done,
      e.total,
      `${courseProgressPercent(e.done, e.total)}%`,
    ];
  });

  const courseRows = ((courses ?? []) as { id: string; title: string }[]).map((c) => {
    const bc = byCourse.get(c.id);
    return {
      title: c.title,
      assigned: bc?.users.size ?? 0,
      completed: bc?.users100 ?? 0,
      pct: bc ? courseProgressPercent(bc.done, bc.total) : 0,
    };
  });

  const userRows = [...byUser.entries()].map(([uid, e]) => ({
    name: memberName.get(uid) ?? "—",
    pct: courseProgressPercent(e.done, e.total),
    done: e.done,
    total: e.total,
  }));

  return (
    <div className="p-6 sm:p-8">
      <Link href="/academy" className="text-sm text-slate-400 hover:text-brand">← Академия</Link>
      <header className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Отчёт по обучению</h1>
        <ExportButton
          filename="academy-report.csv"
          headers={["Курс", "Сотрудник", "Пройдено", "Всего", "Прогресс"]}
          rows={csvRows}
        />
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="По курсам">
          {courseRows.length ? (
            <Table head={["Курс", "Назначено", "Завершили", "Средний"]}>
              {courseRows.map((r) => (
                <tr key={r.title}>
                  <td className="py-2 text-slate-800 dark:text-neutral-200">{r.title}</td>
                  <td className="py-2 text-slate-600 dark:text-neutral-400">{r.assigned}</td>
                  <td className="py-2 text-slate-600 dark:text-neutral-400">{r.completed}</td>
                  <td className="py-2"><ProgressBar pct={r.pct} /></td>
                </tr>
              ))}
            </Table>
          ) : <Empty />}
        </Section>

        <Section title="По отделам">
          {byDept.length ? (
            <Table head={["Отдел", "Прогресс"]}>
              {byDept.map((r) => (
                <tr key={r.name}>
                  <td className="py-2 text-slate-800 dark:text-neutral-200">{r.name}</td>
                  <td className="py-2"><ProgressBar pct={r.pct} /></td>
                </tr>
              ))}
            </Table>
          ) : <Empty />}
        </Section>
      </div>

      <div className="mt-6">
        <Section title="По сотрудникам">
          {userRows.length ? (
            <Table head={["Сотрудник", "Прогресс", "Пройдено"]}>
              {userRows.map((r) => (
                <tr key={r.name}>
                  <td className="py-2 text-slate-800 dark:text-neutral-200">{r.name}</td>
                  <td className="py-2"><ProgressBar pct={r.pct} /></td>
                  <td className="py-2 text-slate-600 dark:text-neutral-400">{r.done}/{r.total}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty />}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface rounded-3xl p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>
      {children}
    </section>
  );
}
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
          {head.map((h) => <th key={h} className="py-2">{h}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-white/[0.07]">{children}</tbody>
    </table>
  );
}
function Empty() {
  return <p className="text-sm text-slate-400">Нет данных.</p>;
}
