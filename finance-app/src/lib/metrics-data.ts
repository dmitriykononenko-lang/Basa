// Общая загрузка данных показателей (для страниц «Показатели» и «Динамика»).
import { createClient } from "@/lib/supabase/server";
import { recentPeriodStarts, type Metric, type MetricPeriod } from "@/lib/metrics";
import type { MetricWithData, OwnerOption, UnitOption } from "@/components/metrics/MetricsView";

const POINTS = 8;

export async function loadMetricsData(teamId: string): Promise<{
  data: MetricWithData[];
  owners: OwnerOption[];
  units: UnitOption[];
}> {
  const supabase = await createClient();

  const [{ data: metricsRaw }, { data: valuesRaw }, { data: membersRaw }, { data: unitsRaw }] = await Promise.all([
    supabase.from("metrics").select("id, team_id, name, unit, owner_user_id, unit_id, period, direction, aggregation, plan, is_active, sort").eq("team_id", teamId).order("sort", { ascending: true }).order("created_at", { ascending: true }),
    supabase.from("metric_values").select("metric_id, period_start, value").eq("team_id", teamId).order("period_start", { ascending: true }),
    supabase.from("team_members").select("user_id, profiles(full_name)").eq("team_id", teamId),
    supabase.from("kb_departments").select("id, name, parent_id").eq("team_id", teamId),
  ]);

  const metrics = (metricsRaw ?? []) as Metric[];
  const values = (valuesRaw ?? []) as { metric_id: string; period_start: string; value: number }[];

  const vmap = new Map<string, number>();
  for (const v of values) vmap.set(`${v.metric_id}|${v.period_start}`, Number(v.value));

  const today = new Date();

  const owners: OwnerOption[] = ((membersRaw ?? []) as { user_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[]).map((m) => ({
    user_id: m.user_id,
    name: (Array.isArray(m.profiles) ? m.profiles[0]?.full_name : m.profiles?.full_name) || "Без имени",
  }));
  const ownerName = new Map(owners.map((o) => [o.user_id, o.name]));

  const units = (unitsRaw ?? []) as UnitOption[];
  const unitName = new Map(units.map((u) => [u.id, u.name]));

  const data: MetricWithData[] = metrics.map((m) => {
    const starts = recentPeriodStarts(today, m.period as MetricPeriod, POINTS);
    const series = starts.map((ps) => ({ period_start: ps, value: vmap.has(`${m.id}|${ps}`) ? vmap.get(`${m.id}|${ps}`)! : null }));
    const current = series[series.length - 1]?.value ?? null;
    return {
      ...m,
      plan: m.plan != null ? Number(m.plan) : null,
      ownerName: m.owner_user_id ? ownerName.get(m.owner_user_id) ?? null : null,
      unitName: m.unit_id ? unitName.get(m.unit_id) ?? null : null,
      series,
      current,
      currentPeriodStart: starts[starts.length - 1],
    };
  });

  return { data, owners, units };
}
