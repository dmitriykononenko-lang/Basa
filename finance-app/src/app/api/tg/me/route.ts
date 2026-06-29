import { NextResponse } from "next/server";
import { resolveTg, tgUserTeam } from "@/lib/tg-session";
import { courseProgressPercent, unitAncestors } from "@/lib/academy";
import { tgDisplayName } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// Сводка обучения для Mini App. Если Telegram-аккаунт ещё не привязан —
// возвращаем { linked: false } и имя из Telegram для экрана привязки.
export async function POST(req: Request) {
  const { initData } = (await req.json().catch(() => ({}))) as { initData?: string };
  const r = await resolveTg(initData ?? "");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  const { admin, tgUser, link } = r.ctx;
  if (!link) {
    return NextResponse.json({ linked: false, tgName: tgDisplayName(tgUser) });
  }

  const uid = link.user_id;
  const team = await tgUserTeam(admin, uid);
  if (!team) {
    return NextResponse.json({ linked: true, name: link.telegram_name ?? tgDisplayName(tgUser), courses: [] });
  }

  // Мой прогресс по курсам.
  const { data: prog } = await admin
    .from("academy_progress")
    .select("course_id, status")
    .eq("user_id", uid);
  const byCourse = new Map<string, { done: number; total: number }>();
  for (const p of (prog ?? []) as { course_id: string; status: string }[]) {
    const e = byCourse.get(p.course_id) ?? { done: 0, total: 0 };
    e.total += 1;
    if (p.status === "done") e.done += 1;
    byCourse.set(p.course_id, e);
  }
  const courseIds = [...byCourse.keys()];
  if (courseIds.length === 0) {
    return NextResponse.json({ linked: true, name: link.telegram_name ?? tgDisplayName(tgUser), courses: [] });
  }

  // Названия курсов + дедлайны (как в /academy).
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: courses }, { data: myCp }, { data: unitRows }, { data: assigns }] = await Promise.all([
    admin.from("academy_courses").select("id, title, cover_url").in("id", courseIds),
    admin.from("counterparties").select("unit_id").eq("team_id", team.id).eq("user_id", uid).contains("kinds", ["employee"]).maybeSingle(),
    admin.from("kb_departments").select("id, parent_id").eq("team_id", team.id),
    admin.from("academy_assignments").select("course_id, assignee_type, department_id, user_id, due_date").eq("team_id", team.id).in("course_id", courseIds),
  ]);
  const parentOf = new Map(((unitRows ?? []) as { id: string; parent_id: string | null }[]).map((u) => [u.id, u.parent_id]));
  const myUnitIds = unitAncestors((myCp as { unit_id: string | null } | null)?.unit_id, parentOf);
  const dueByCourse = new Map<string, string>();
  for (const a of (assigns ?? []) as { course_id: string; assignee_type: string; department_id: string | null; user_id: string | null; due_date: string | null }[]) {
    const applies = (a.assignee_type === "user" && a.user_id === uid) || (a.assignee_type === "department" && a.department_id && myUnitIds.has(a.department_id));
    if (!applies || !a.due_date) continue;
    const cur = dueByCourse.get(a.course_id);
    if (!cur || a.due_date < cur) dueByCourse.set(a.course_id, a.due_date);
  }

  const out = ((courses ?? []) as { id: string; title: string; cover_url: string | null }[]).map((c) => {
    const e = byCourse.get(c.id) ?? { done: 0, total: 0 };
    const pct = courseProgressPercent(e.done, e.total);
    const allDone = e.total > 0 && e.done === e.total;
    return { id: c.id, title: c.title, cover_url: c.cover_url, done: e.done, total: e.total, pct, allDone, due: dueByCourse.get(c.id) ?? null };
  });

  return NextResponse.json({
    linked: true,
    name: link.telegram_name ?? tgDisplayName(tgUser),
    today,
    courses: out,
  });
}
