"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; name: string; kind: "income" | "expense" };
type Named = { id: string; name: string };
export type Rule = {
  id: string; match_field: string; pattern: string;
  category_id: string | null; project_id: string | null;
};

const FIELDS: Record<string, string> = { any: "везде", counterparty: "контрагент", note: "назначение" };

export default function CategoryRulesManager({
  teamId, userId, rules, categories, projects,
}: {
  teamId: string;
  userId: string;
  rules: Rule[];
  categories: Category[];
  projects: Named[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState("any");
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";
  const prName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? null;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pattern.trim() || !categoryId) return setError("Укажите текст и статью");
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("category_rules").insert({
      team_id: teamId, match_field: field, pattern: pattern.trim(),
      category_id: categoryId, project_id: projectId || null, created_by: userId,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setPattern(""); setCategoryId(""); setProjectId("");
    router.refresh();
  }

  async function remove(id: string) {
    const supabase = createClient();
    await supabase.from("category_rules").delete().eq("id", id);
    router.refresh();
  }

  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-sm font-semibold text-slate-800 dark:text-neutral-200">
        <span>Правила авто-категоризации {rules.length > 0 && <span className="text-slate-400">({rules.length})</span>}</span>
        <span className="text-xs text-slate-400">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-400 dark:text-neutral-500">
            При импорте, если статья не определилась по названию, она проставится по первому
            подходящему правилу: если текст контрагента/назначения содержит подстроку — ставим статью (и проект).
          </p>

          {rules.length > 0 && (
            <ul className="space-y-1.5 text-sm">
              {rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/[0.03]">
                  <span className="text-slate-600 dark:text-neutral-300">
                    «{r.pattern}» в {FIELDS[r.match_field] ?? r.match_field} → <b>{catName(r.category_id)}</b>
                    {prName(r.project_id) && <span className="text-slate-400"> · {prName(r.project_id)}</span>}
                  </span>
                  <button onClick={() => remove(r.id)} className="text-xs text-slate-400 hover:text-red-500">✕</button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={add} className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Где искать</label>
              <Select className="w-32" value={field} onChange={setField} options={[{ value: "any", label: "везде" }, { value: "counterparty", label: "контрагент" }, { value: "note", label: "назначение" }]} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Текст содержит</label>
              <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="напр. налог, аренда, СБП" className="input w-44 py-1.5 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Статья</label>
              <Select className="w-44" value={categoryId} onChange={setCategoryId} placeholder="— выберите —" options={[{ value: "", label: "— выберите —" }, ...categories.map((c) => ({ value: c.id, label: `${c.name} (${c.kind === "income" ? "дох" : "рас"})` }))]} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Проект</label>
              <Select className="w-40" value={projectId} onChange={setProjectId} placeholder="— без проекта —" options={[{ value: "", label: "— без проекта —" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
            </div>
            <button type="submit" disabled={busy} className="rounded-full bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Добавить</button>
          </form>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
        </div>
      )}
    </div>
  );
}
