"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CF_ACTIVITIES, CF_ACTIVITY_LABELS, PNL_TREATMENTS } from "@/lib/constants";

export type CategoryData = {
  id: string;
  name: string;
  kind: "income" | "expense";
  parent_id: string | null;
  note: string | null;
  cf_activity: string;
  pnl_treatment: string;
  archived: boolean;
};

const ACTIVITY_COLOR: Record<string, string> = {
  operating: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  investing: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  financial: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
};

export default function CategoryEditor({
  category,
  parents,
  manage,
  child,
}: {
  category: CategoryData;
  parents: { id: string; name: string }[];
  manage: boolean;
  child?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(category.name);
  const [parentId, setParentId] = useState(category.parent_id ?? "");
  const [note, setNote] = useState(category.note ?? "");
  const [cf, setCf] = useState(category.cf_activity);
  const [pnl, setPnl] = useState(category.pnl_treatment);

  async function save() {
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("categories")
      .update({
        name,
        parent_id: parentId || null,
        note: note || null,
        cf_activity: cf,
        pnl_treatment: pnl,
      })
      .eq("id", category.id);
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setEditing(false);
    setBusy(false);
    router.refresh();
  }

  async function toggleArchive() {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("categories").update({ archived: !category.archived }).eq("id", category.id);
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm("Удалить статью? Операции по ней останутся без статьи.")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("categories").delete().eq("id", category.id);
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className={`group flex items-start justify-between gap-3 px-5 py-3 ${child ? "pl-10" : ""}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-neutral-300">
          {child && <span className="text-slate-300">└</span>}
          <span className="break-words">{category.name}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${ACTIVITY_COLOR[category.cf_activity] ?? ""}`}>
            {CF_ACTIVITY_LABELS[category.cf_activity]}
          </span>
        </div>
        {manage && (
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-full px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 group-hover:text-slate-600 dark:hover:bg-neutral-800"
          >
            Изм.
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 bg-slate-50/60 px-5 py-4 dark:bg-neutral-800/30">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Название</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Группа</label>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input">
            <option value="">— верхний уровень —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Комментарий</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Заметка для выбора статьи" className="input" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
            Вид деятельности (для ДДС)
          </label>
          <select value={cf} onChange={(e) => setCf(e.target.value)} className="input">
            {CF_ACTIVITIES.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">
            {CF_ACTIVITIES.find((a) => a.value === cf)?.hint}
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
            Учёт в ОПиУ
          </label>
          <select value={pnl} onChange={(e) => setPnl(e.target.value)} className="input">
            {PNL_TREATMENTS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={busy} className="btn-primary">
          {busy ? "…" : "Сохранить"}
        </button>
        <button onClick={() => setEditing(false)} className="btn-ghost">Отмена</button>
        <button onClick={toggleArchive} disabled={busy} className="btn-ghost">
          {category.archived ? "Вернуть из архива" : "В архив"}
        </button>
        <button onClick={remove} disabled={busy} className="ml-auto rounded-full px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">
          Удалить
        </button>
      </div>
    </div>
  );
}
