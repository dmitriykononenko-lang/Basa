import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import type { Metric, MetricValue } from "@/lib/metrics";
import MetricDetail from "@/components/metrics/MetricDetail";

export const dynamic = "force-dynamic";

export default async function MetricDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Показатель</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }
  const { team, role } = current;
  const canManage = canEditFinance(role);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id ?? null;

  const { data: metricRaw } = await supabase
    .from("metrics")
    .select("id, team_id, name, unit, owner_user_id, unit_id, period, direction, aggregation, plan, is_active, sort")
    .eq("team_id", team.id)
    .eq("id", id)
    .maybeSingle();
  if (!metricRaw) notFound();
  const metric = { ...(metricRaw as Metric), plan: (metricRaw as Metric).plan != null ? Number((metricRaw as Metric).plan) : null };

  const [{ data: valuesRaw }, ownerRes, unitRes] = await Promise.all([
    supabase.from("metric_values").select("id, metric_id, period_start, value, note").eq("metric_id", id).order("period_start", { ascending: true }),
    metric.owner_user_id ? supabase.from("profiles").select("full_name").eq("id", metric.owner_user_id).maybeSingle() : Promise.resolve({ data: null }),
    metric.unit_id ? supabase.from("kb_departments").select("name").eq("id", metric.unit_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const values = ((valuesRaw ?? []) as MetricValue[]).map((v) => ({ ...v, value: Number(v.value) }));

  return (
    <MetricDetail
      metric={metric}
      values={values}
      ownerName={(ownerRes.data as { full_name: string | null } | null)?.full_name ?? null}
      unitName={(unitRes.data as { name: string } | null)?.name ?? null}
      canEnter={canManage || metric.owner_user_id === uid}
      uid={uid}
    />
  );
}
