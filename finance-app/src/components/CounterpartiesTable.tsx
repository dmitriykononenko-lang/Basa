"use client";

import { useMemo, useState } from "react";
import { Select } from "@/components/ui/select";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COUNTERPARTY_KINDS, COUNTERPARTY_KIND_LABELS } from "@/lib/constants";

type Item = {
  id: string;
  name: string;
  kind: string;
  kinds: string[] | null;
  inn: string | null;
  contact_person: string | null;
};

const itemKinds = (c: Item): string[] => (c.kinds && c.kinds.length ? c.kinds : (c.kind ? [c.kind] : []));

export default function CounterpartiesTable({ items, canManage }: { items: Item[]; canManage: boolean }) {
  const router = useRouter();
  const [kindFilter, setKindFilter] = useState("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkKind, setBulkKind] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return items.filter((c) => {
      if (kindFilter !== "all" && !itemKinds(c).includes(kindFilter)) return false;
      if (ql && !(`${c.name} ${c.inn ?? ""}`.toLowerCase().includes(ql))) return false;
      return true;
    });
  }, [items, kindFilter, q]);

  function toggle(id: string) {
    setSel((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSel((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((c) => c.id))));
  }

  async function applyKind() {
    if (!bulkKind || sel.size === 0) return;
    setBusy(true); setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("counterparties").update({ kind: bulkKind, kinds: [bulkKind] }).in("id", [...sel]);
    setBusy(false);
    if (error) { setError(error.message); return; }
    setSel(new Set()); setBulkKind("");
    router.refresh();
  }

  async function mergeInto(targetId: string) {
    const dups = [...sel].filter((id) => id !== targetId);
    if (dups.length === 0) return;
    const targetName = items.find((c) => c.id === targetId)?.name ?? "";
    if (!confirm(`Объединить ${dups.length} карточек в «${targetName}»? Все операции и связи перейдут к ней, дубли удалятся.`)) return;
    setBusy(true); setError(null);
    const supabase = createClient();
    for (const dup of dups) {
      const { error } = await supabase.rpc("merge_counterparties", { p_target: targetId, p_dup: dup });
      if (error) { setBusy(false); setError(error.message); return; }
    }
    setBusy(false);
    setSel(new Set()); setMergeOpen(false);
    router.refresh();
  }

  async function bulkDelete() {
    if (sel.size === 0) return;
    if (!confirm(`Удалить контрагентов: ${sel.size}? Действие необратимо.`)) return;
    setBusy(true); setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("counterparties").delete().in("id", [...sel]);
    setBusy(false);
    if (error) {
      setError("Не удалось удалить — у части контрагентов есть связанные операции или начисления. Сначала удалите/перепривяжите их.");
      return;
    }
    setSel(new Set());
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-auto" value={kindFilter} onChange={setKindFilter} options={[{ value: "all", label: "Все типы" }, ...COUNTERPARTY_KINDS.map((k) => ({ value: k.value, label: k.label }))]} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по названию или ИНН…"
          className="input w-64 max-w-full py-2 text-sm"
        />
        <span className="text-xs text-slate-400">{filtered.length} из {items.length}</span>
      </div>

      {/* Тулбар массовых действий */}
      {canManage && sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-brand/5 px-3 py-2 ring-1 ring-brand/20">
          <span className="text-sm font-medium text-slate-700 dark:text-neutral-200">Выбрано: {sel.size}</span>
          <Select className="w-auto" value={bulkKind} onChange={setBulkKind} placeholder="Сменить тип…" options={[{ value: "", label: "Сменить тип…" }, ...COUNTERPARTY_KINDS.map((k) => ({ value: k.value, label: k.label }))]} />
          <button onClick={applyKind} disabled={busy || !bulkKind} className="rounded-full bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Применить</button>
          {sel.size >= 2 && (
            <button onClick={() => { setMergeTarget([...sel][0]); setMergeOpen((o) => !o); }} disabled={busy} className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-brand ring-1 ring-brand/30 disabled:opacity-50 dark:bg-white/[0.06]">Объединить</button>
          )}
          <button onClick={bulkDelete} disabled={busy} className="rounded-full bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 ring-1 ring-red-200 disabled:opacity-50 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/40">Удалить</button>
          <button onClick={() => setSel(new Set())} className="rounded-full px-3 py-1.5 text-sm text-slate-500">Снять выделение</button>
        </div>
      )}

      {/* Панель объединения: выбрать основную карточку */}
      {canManage && mergeOpen && sel.size >= 2 && (
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <div className="mb-2 text-sm font-medium text-slate-700 dark:text-neutral-200">Какую карточку оставить (основная)?</div>
          <div className="mb-3 space-y-1.5">
            {[...sel].map((id) => {
              const c = items.find((x) => x.id === id);
              if (!c) return null;
              return (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="mergeTarget" checked={mergeTarget === id} onChange={() => setMergeTarget(id)} />
                  <span className="text-slate-700 dark:text-neutral-300">{c.name}{c.inn ? ` · ИНН ${c.inn}` : ""}</span>
                </label>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button onClick={() => mergeInto(mergeTarget)} disabled={busy || !mergeTarget} className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Объединяем…" : `Объединить ${sel.size} → основную`}
            </button>
            <button onClick={() => setMergeOpen(false)} className="rounded-full px-3 py-1.5 text-sm text-slate-500">Отмена</button>
          </div>
        </div>
      )}
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}

      {filtered.length > 0 ? (
        <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                {canManage && (
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" checked={sel.size === filtered.length && filtered.length > 0} onChange={toggleAll} />
                  </th>
                )}
                <th className="px-5 py-3 font-medium">Название</th>
                <th className="px-5 py-3 font-medium">Тип</th>
                <th className="px-5 py-3 font-medium">ИНН</th>
                <th className="px-5 py-3 font-medium">Контакт</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                  {canManage && (
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
                    </td>
                  )}
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/counterparties/${c.id}`} className="break-words text-slate-800 hover:text-brand dark:text-neutral-200">{c.name}</Link>
                  </td>
                  <td className="px-5 py-3">
                    <span className="flex flex-wrap gap-1">
                      {itemKinds(c).map((k) => (
                        <span key={k} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
                          {COUNTERPARTY_KIND_LABELS[k] ?? k}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{c.inn ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{c.contact_person ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Ничего не найдено по фильтру.
        </p>
      )}
    </div>
  );
}
