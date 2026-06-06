"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

type Category = { id: string; name: string };
export type Rule = { id: string; category_id: string | null; percent: number };

export default function AgentCommissionRules({
  teamId, userId, agentId, rules, incomeCategories,
}: {
  teamId: string;
  userId: string;
  agentId: string;
  rules: Rule[];
  incomeCategories: Category[];
}) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState("");
  const [percent, setPercent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catName = (id: string | null) => (id ? incomeCategories.find((c) => c.id === id)?.name ?? "—" : "Все статьи (по умолчанию)");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const pct = parseFloat(percent.replace(",", "."));
    if (isNaN(pct) || pct < 0) return setError("Введите процент (0 или больше)");
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("agent_commission_rules").insert({
      team_id: teamId, agent_id: agentId, category_id: categoryId || null, percent: pct, created_by: userId,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setPercent(""); setCategoryId("");
    toast.success("Ставка добавлена");
    router.refresh();
  }

  async function remove(id: string) {
    const supabase = createClient();
    await supabase.from("agent_commission_rules").delete().eq("id", id);
    router.refresh();
  }

  return (
    <section className="rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
        Ставки комиссии
      </h2>
      <p className="mb-3 text-xs text-slate-400 dark:text-neutral-500">
        Процент комиссии по статье дохода. «Все статьи» — ставка по умолчанию, если для статьи нет своей.
        Комиссия начисляется автоматически при приходе денег от клиентов этого агента.
      </p>

      {rules.length > 0 ? (
        <ul className="mb-3 space-y-1.5 text-sm">
          {[...rules].sort((a, b) => (a.category_id ? 1 : 0) - (b.category_id ? 1 : 0)).map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/[0.03]">
              <span className="text-slate-600 dark:text-neutral-300">{catName(r.category_id)}</span>
              <span className="flex items-center gap-3">
                <b className="text-slate-800 dark:text-neutral-100">{r.percent}%</b>
                <button onClick={() => remove(r.id)} className="text-xs text-slate-400 hover:text-red-500" title="Удалить">✕</button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-slate-400">Ставки не заданы — комиссия не начисляется.</p>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Статья</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input w-52 py-1.5 text-sm">
            <option value="">Все статьи (по умолчанию)</option>
            {incomeCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Комиссия, %</label>
          <input value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="decimal" placeholder="10" className="input w-24 py-1.5 text-sm" />
        </div>
        <button type="submit" disabled={busy} className="rounded-full bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Добавить</button>
      </form>
      {error && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
    </section>
  );
}
