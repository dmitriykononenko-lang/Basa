"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { unitAncestors } from "@/lib/academy";

type Stats = { courses: number; completed: number; overdue: number };

export default function AcademyWidget() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        if (active) setStats({ courses: 0, completed: 0, overdue: 0 });
        return;
      }
      const today = new Date().toISOString().slice(0, 10);

      const [{ data: prog }, { data: myCps }, { data: unitRows }] = await Promise.all([
        supabase.from("academy_progress").select("course_id, status").eq("user_id", uid),
        supabase.from("counterparties").select("unit_id").eq("user_id", uid).contains("kinds", ["employee"]),
        supabase.from("kb_departments").select("id, parent_id"),
      ]);

      const byCourse = new Map<string, { done: number; total: number }>();
      for (const p of (prog ?? []) as { course_id: string; status: string }[]) {
        const e = byCourse.get(p.course_id) ?? { done: 0, total: 0 };
        e.total += 1;
        if (p.status === "done") e.done += 1;
        byCourse.set(p.course_id, e);
      }
      const courseIds = [...byCourse.keys()];
      // мои узлы оргструктуры + все предки (назначение «на отдел» = узел и его поддерево)
      const parentOf = new Map(((unitRows ?? []) as { id: string; parent_id: string | null }[]).map((u) => [u.id, u.parent_id]));
      const deptIds = new Set<string>();
      for (const cp of (myCps ?? []) as { unit_id: string | null }[]) {
        for (const node of unitAncestors(cp.unit_id, parentOf)) deptIds.add(node);
      }

      const dueByCourse = new Map<string, string>();
      if (courseIds.length) {
        const { data: assigns } = await supabase
          .from("academy_assignments")
          .select("course_id, assignee_type, department_id, user_id, due_date")
          .in("course_id", courseIds);
        for (const a of (assigns ?? []) as { course_id: string; assignee_type: string; department_id: string | null; user_id: string | null; due_date: string | null }[]) {
          const applies =
            (a.assignee_type === "user" && a.user_id === uid) ||
            (a.assignee_type === "department" && a.department_id && deptIds.has(a.department_id));
          if (!applies || !a.due_date) continue;
          const cur = dueByCourse.get(a.course_id);
          if (!cur || a.due_date < cur) dueByCourse.set(a.course_id, a.due_date);
        }
      }

      let completed = 0;
      let overdue = 0;
      for (const [cid, e] of byCourse) {
        const allDone = e.total > 0 && e.done === e.total;
        if (allDone) completed += 1;
        const due = dueByCourse.get(cid);
        if (due && !allDone && due < today) overdue += 1;
      }
      if (active) setStats({ courses: byCourse.size, completed, overdue });
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <Link
      href="/academy"
      className="block rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 transition hover:ring-brand/40 dark:bg-[#15171c] dark:ring-white/[0.07]"
    >
      <div className="text-sm text-slate-500 dark:text-neutral-400">Обучение</div>
      {stats ? (
        <>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
            {stats.completed}/{stats.courses}
            <span className="ml-2 text-sm font-normal text-slate-400">курсов пройдено</span>
          </div>
          {stats.overdue > 0 ? (
            <div className="mt-2 inline-block rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-400">
              просрочено: {stats.overdue}
            </div>
          ) : stats.courses > 0 ? (
            <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">нет просрочек</div>
          ) : (
            <div className="mt-2 text-xs text-slate-400">нет назначенных курсов</div>
          )}
        </>
      ) : (
        <div className="mt-2 h-8 w-24 animate-pulse rounded bg-slate-100 dark:bg-neutral-800" />
      )}
    </Link>
  );
}
