"use client";

import { useMemo, useState } from "react";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";

export type Cat = { id: string; name: string; kind: "income" | "expense" };
export type Row = {
  id: string;
  type: "income" | "expense";
  amount: number;
  currency: string;
  occurred_on: string;
  note: string | null;
  account: { name: string } | null;
};

function counterpartyOf(note: string | null): string {
  if (!note) return "Без контрагента";
  return note.split(" · ")[0].trim() || "Без контрагента";
}

export default function UncategorizedSorter({ rows, categories }: { rows: Row[]; categories: Cat[] }) {
  const [items, setItems] = useState<Row[]>(rows);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const incomeCats = categories.filter((c) => c.kind === "income");
  const expenseCats = categories.filter((c) => c.kind === "expense");

  // Группировка: контрагент + тип (приход/расход), чтобы статья совпадала по виду
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; cp: string; type: "income" | "expense"; rows: Row[] }>();
    for (const r of items) {
      const cp = counterpartyOf(r.note);
      const key = `${r.type}|${cp}`;
      if (!m.has(key)) m.set(key, { key, cp, type: r.type, rows: [] });
      m.get(key)!.rows.push(r);
    }
    let arr = [...m.values()];
    const f = filter.trim().toLowerCase();
    if (f) arr = arr.filter((g) => g.cp.toLowerCase().includes(f));
    // крупные группы выше
    return arr.sort((a, b) => b.rows.length - a.rows.length);
  }, [items, filter]);

  async function assign(group: { rows: Row[] }, categoryId: string) {
    if (!categoryId) return;
    const ids = group.rows.map((r) => r.id);
    setBusy(ids[0]);
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.from("transactions").update({ category_id: categoryId }).in("id", ids);
    setBusy(null);
    if (e) {
      setError(e.message);
      return;
    }
    const idset = new Set(ids);
    setItems((prev) => prev.filter((r) => !idset.has(r.id)));
  }

  const remaining = items.length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Поиск по контрагенту…"
          className="w-64 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-brand dark:border-white/[0.1] dark:bg-[#15171c] dark:text-neutral-200"
        />
        <span className="text-sm text-slate-500 dark:text-neutral-400">Осталось без статьи: <b>{remaining}</b></span>
      </div>

      {error && (
        <div className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">{error}</div>
      )}

      {remaining === 0 ? (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Все операции разнесены по статьям 🎉
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const cats = g.type === "income" ? incomeCats : expenseCats;
            const sum = g.rows.reduce((s, r) => s + r.amount, 0);
            return (
              <div key={g.key} className="rounded-3xl bg-white p-4 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800 dark:text-neutral-200">{g.cp}</div>
                    <div className="text-xs text-slate-400 dark:text-neutral-500">
                      {g.type === "income" ? "Приход" : "Расход"} · {g.rows.length} оп. ·{" "}
                      <span className={g.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                        {formatMoney(sum, g.rows[0].currency)}
                      </span>
                    </div>
                  </div>
                  <Select variant="pill" value="" disabled={busy === g.rows[0].id} onChange={(v) => assign(g, v)} placeholder="— выбрать статью для всей группы —" options={[{ value: "", label: "— выбрать статью для всей группы —" }, ...cats.map((c) => ({ value: c.id, label: c.name }))]} />
                </div>

                <div className="mt-3 max-h-44 overflow-y-auto border-t border-slate-100 pt-2 dark:border-white/[0.06]">
                  {g.rows.slice(0, 50).map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 py-1 text-xs">
                      <span className="whitespace-nowrap text-slate-400">{formatDate(r.occurred_on)}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-neutral-400">
                        {r.account?.name ?? ""}
                        {r.note && r.note.includes(" · ") && <span className="ml-2 text-slate-400">· {r.note.split(" · ").slice(1).join(" · ")}</span>}
                      </span>
                      <span className={`whitespace-nowrap font-medium ${r.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {r.type === "income" ? "+" : "−"}{formatMoney(r.amount, r.currency)}
                      </span>
                    </div>
                  ))}
                  {g.rows.length > 50 && (
                    <div className="py-1 text-center text-[11px] text-slate-400">…и ещё {g.rows.length - 50}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
