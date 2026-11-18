"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

export type Tier = { id: string; max_overrun_wd: number; percent: number };

const INF = 2147483647;
const DEFAULTS: [number, number][] = [[0, 100], [2, 90], [5, 75], [10, 50], [INF, 0]];

export default function ProjectBonusTiers({ teamId, tiers, canEdit }: { teamId: string; tiers: Tier[]; canEdit: boolean }) {
  const router = useRouter();
  const [maxWd, setMaxWd] = useState("");
  const [percent, setPercent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = [...tiers].sort((a, b) => a.max_overrun_wd - b.max_overrun_wd);

  function label(wd: number, i: number): string {
    const prev = i === 0 ? 0 : sorted[i - 1].max_overrun_wd + 1;
    if (wd >= INF) return `${prev}+ раб. дн`;
    if (wd === 0) return "в срок (0)";
    return prev === wd ? `${wd} раб. дн` : `${prev}–${wd} раб. дн`;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const wd = maxWd.trim().toLowerCase() === "∞" || maxWd.trim() === "" ? INF : parseInt(maxWd, 10);
    const pct = parseFloat(percent.replace(",", "."));
    if (isNaN(wd) || wd < 0) return setError("Введите число рабочих дней (или ∞ для остального)");
    if (isNaN(pct) || pct < 0) return setError("Введите процент (0 и больше)");
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("project_bonus_tiers").insert({ team_id: teamId, max_overrun_wd: wd, percent: pct });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setMaxWd(""); setPercent("");
    toast.success("Ступень добавлена");
    router.refresh();
  }

  async function remove(id: string) {
    const supabase = createClient();
    await supabase.from("project_bonus_tiers").delete().eq("id", id);
    router.refresh();
  }

  async function resetDefaults() {
    if (!confirm("Сбросить ступени к стандартным (в срок 100%, до 2 дн 90%, до 5 — 75%, до 10 — 50%, далее 0%)?")) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.from("project_bonus_tiers").delete().eq("team_id", teamId);
    await supabase.from("project_bonus_tiers").insert(DEFAULTS.map(([wd, pct]) => ({ team_id: teamId, max_overrun_wd: wd, percent: pct })));
    setBusy(false);
    toast.success("Ступени сброшены к стандартным");
    router.refresh();
  }

  return (
    <section className="rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
        Ступени бонуса за сдачу проекта
      </h2>
      <p className="mb-4 text-xs text-slate-400 dark:text-neutral-500">
        Сколько процентов бонуса получает аналитик в зависимости от просрочки срока (в рабочих днях). Берётся
        наименьшая подходящая ступень. Изменение пересчитывает бонусы уже сданных проектов.
      </p>

      {sorted.length > 0 ? (
        <ul className="mb-4 space-y-1.5 text-sm">
          {sorted.map((t, i) => (
            <li key={t.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/[0.03]">
              <span className="text-slate-600 dark:text-neutral-300">{label(t.max_overrun_wd, i)}</span>
              <span className="flex items-center gap-3">
                <b className="text-slate-800 dark:text-neutral-100">{Number(t.percent)}%</b>
                {canEdit && <button onClick={() => remove(t.id)} className="text-xs text-slate-400 hover:text-red-500" title="Удалить">✕</button>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-slate-400">Ступени не заданы — бонус начисляется полностью (100%).</p>
      )}

      {canEdit && (
        <>
          <form onSubmit={add} className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">До скольких раб. дней просрочки</label>
              <input value={maxWd} onChange={(e) => setMaxWd(e.target.value)} placeholder="напр. 5 или ∞" className="input w-40 py-1.5 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">% бонуса</label>
              <input value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="decimal" placeholder="напр. 75" className="input w-28 py-1.5 text-sm" />
            </div>
            <button type="submit" disabled={busy} className="rounded-full bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Добавить</button>
            <button type="button" onClick={resetDefaults} disabled={busy} className="rounded-full px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-neutral-400">Сбросить к стандартным</button>
          </form>
          {error && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
        </>
      )}
    </section>
  );
}
