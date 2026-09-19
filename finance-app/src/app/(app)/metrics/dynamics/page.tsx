import { getCurrentTeam } from "@/lib/team";
import { loadMetricsData } from "@/lib/metrics-data";
import MetricsDynamics from "@/components/metrics/MetricsDynamics";
import { ensureVisible } from "@/lib/visibility-guard";

export const dynamic = "force-dynamic";

export default async function MetricsDynamicsPage() {
  await ensureVisible("metrics");
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Динамика показателей</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }
  const { data } = await loadMetricsData(current.team.id);
  return <MetricsDynamics metrics={data} />;
}
