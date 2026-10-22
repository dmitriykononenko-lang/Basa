"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { achievement, periodStart, type MetricPeriod, type MetricDirection } from "@/lib/metrics";

type Stats = { total: number; withPlan: number; onTrack: number; below: number };

export default function MetricsWidget() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = createClient();
      const [{ data: metrics }, { data: vals }] = await Promise.all([
        supabase.from("metrics").select("id, period, direction, plan").eq("is_active", true),
        supabase.from("metric_values").select("metric_id, period_start, value"),
      ]);
      const today = new Date();
      const vmap = new Map<string, number>();
      for (const v of (vals ?? []) as { metric_id: string; period_start: string; value: number }[]) {
        vmap.set(`${v.metric_id}|${v.period_start}`, Number(v.value));
      }
      let withPlan = 0, onTrack = 0, below = 0;
      for (const m of (metrics ?? []) as { id: string; period: MetricPeriod; direction: MetricDirection; plan: number | null }[]) {
        if (m.plan == null) continue;
        withPlan += 1;
        const cps = periodStart(today, m.period);
        const cur = vmap.has(`${m.id}|${cps}`) ? vmap.get(`${m.id}|${cps}`)! : null;
        const { good } = achievement(cur, Number(m.plan), m.direction);
        if (good) onTrack += 1;
        else below += 1;
      }
      if (active) setStats({ total: (metrics ?? []).length, withPlan, onTrack, below });
    })();
    return () => { active = false; };
  }, []);

  return (
    <Link
      href="/metrics"
      className="block rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 transition hover:ring-brand/40 dark:bg-[#15171c] dark:ring-white/[0.07]"
    >
      <div className="text-sm text-slate-500 dark:text-neutral-400">Показатели</div>
      {stats ? (
        <>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
            {stats.onTrack}/{stats.withPlan}
            <span className="ml-2 text-sm font-normal text-slate-400">в плане</span>
          </div>
          {stats.below > 0 ? (
            <div className="mt-2 inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              ниже плана: {stats.below}
            </div>
          ) : stats.withPlan > 0 ? (
            <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">все в плане</div>
          ) : (
            <div className="mt-2 text-xs text-slate-400">{stats.total > 0 ? "планы не заданы" : "нет показателей"}</div>
          )}
        </>
      ) : (
        <div className="mt-2 h-8 w-24 animate-pulse rounded bg-slate-100 dark:bg-neutral-800" />
      )}
    </Link>
  );
}
