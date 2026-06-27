import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { recentPeriodStarts, type Metric, type MetricPeriod } from "@/lib/metrics";
import MetricsView, { type MetricWithData, type OwnerOption, type UnitOption } from "@/components/metrics/MetricsView";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Показатели</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }
  const { team, role } = current;
  const canManage = canEditFinance(role);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id ?? null;

  const [{ data: metricsRaw }, { data: valuesRaw }, { data: membersRaw }, { data: unitsRaw }] = await Promise.all([
    supabase.from("metrics").select("id, team_id, name, unit, owner_user_id, unit_id, period, direction, aggregation, plan, is_active, sort").eq("team_id", team.id).order("sort", { ascending: true }).order("created_at", { ascending: true }),
    supabase.from("metric_values").select("metric_id, period_start, value").eq("team_id", team.id).order("period_start", { ascending: true }),
    supabase.from("team_members").select("user_id, profiles(full_name)").eq("team_id", team.id),
    supabase.from("kb_departments").select("id, name, parent_id").eq("team_id", team.id),
  ]);

  const metrics = (metricsRaw ?? []) as Metric[];
  const values = (valuesRaw ?? []) as { metric_id: string; period_start: string; value: number }[];

  // карта значений: `${metric_id}|${period_start}` → value
  const vmap = new Map<string, number>();
  for (const v of values) vmap.set(`${v.metric_id}|${v.period_start}`, Number(v.value));

  const today = new Date();
  const POINTS = 8;

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

  return (
    <MetricsView
      metrics={data}
      owners={owners}
      units={units}
      uid={uid}
      canManage={canManage}
    />
  );
}
