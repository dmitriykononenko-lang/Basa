"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

type Member = { id: string; name: string; inn: string | null };
export type DupGroup = Member[];

export default function DuplicateSuggestions({ groups }: { groups: DupGroup[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  // основная карточка по группе (по умолчанию первая)
  const [primary, setPrimary] = useState<Record<number, string>>(() =>
    Object.fromEntries(groups.map((g, i) => [i, g[0].id]))
  );
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = groups.map((g, i) => ({ g, i })).filter(({ i }) => !dismissed.has(i));
  if (visible.length === 0) return null;

  async function merge(gi: number) {
    const group = groups[gi];
    const target = primary[gi] ?? group[0].id;
    const dups = group.filter((m) => m.id !== target);
    if (dups.length === 0) return;
    const targetName = group.find((m) => m.id === target)?.name ?? "";
    if (!confirm(`Объединить ${group.length} карточек в «${targetName}»? Все связи перейдут к ней, дубли удалятся.`)) return;
    setBusy(gi); setError(null);
    const supabase = createClient();
    for (const d of dups) {
      const { error } = await supabase.rpc("merge_counterparties", { p_target: target, p_dup: d.id });
      if (error) { setBusy(null); setError(error.message); return; }
    }
    setBusy(null);
    setDismissed((s) => new Set(s).add(gi));
    toast.success("Карточки объединены");
    router.refresh();
  }

  return (
    <div className="mb-4 rounded-3xl bg-amber-50 p-4 ring-1 ring-amber-200 dark:bg-amber-950/20 dark:ring-amber-900/40">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
          🔎 Похоже на дубли: {visible.length} {visible.length === 1 ? "группа" : "групп(ы)"}
        </span>
        <span className="text-xs text-amber-700 dark:text-amber-300">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
          {visible.map(({ g, i }) => (
            <div key={i} className="rounded-2xl bg-white p-3 ring-1 ring-amber-100 dark:bg-[#15171c] dark:ring-white/[0.06]">
              <div className="mb-2 text-xs text-slate-500 dark:text-neutral-400">Оставить как основную:</div>
              <div className="space-y-1">
                {g.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input type="radio" name={`dup-${i}`} checked={(primary[i] ?? g[0].id) === m.id}
                      onChange={() => setPrimary((p) => ({ ...p, [i]: m.id }))} />
                    <span className="text-slate-700 dark:text-neutral-300">{m.name}{m.inn ? ` · ИНН ${m.inn}` : ""}</span>
                  </label>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <button onClick={() => merge(i)} disabled={busy === i} className="rounded-full bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                  {busy === i ? "Объединяем…" : `Объединить (${g.length})`}
                </button>
                <button onClick={() => setDismissed((s) => new Set(s).add(i))} className="rounded-full px-3 py-1.5 text-sm text-slate-500">Не дубли</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
