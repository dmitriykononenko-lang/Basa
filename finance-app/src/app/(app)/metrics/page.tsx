import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { createClient } from "@/lib/supabase/server";
import { loadMetricsData } from "@/lib/metrics-data";
import MetricsView from "@/components/metrics/MetricsView";
import { ensureVisible } from "@/lib/visibility-guard";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  await ensureVisible("metrics");
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

  const { data, owners, units } = await loadMetricsData(team.id);

  return (
    <MetricsView
      metrics={data}
      owners={owners}
      units={units}
      uid={uid}
      teamId={team.id}
      canManage={canManage}
    />
  );
}
