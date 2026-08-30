"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { Select } from "@/components/ui/select";
import Modal from "@/components/Modal";

export type OrgUnit = {
  id: string;
  name: string;
  parent_id: string | null;
  unit_type: "department" | "division" | "team" | "position";
  result_text: string | null;
  functions_text: string | null;
  head_counterparty_id: string | null;
  sort: number;
};
type Emp = { id: string; name: string };

export const UNIT_TYPE_LABELS: Record<OrgUnit["unit_type"], string> = {
  department: "Департамент",
  division: "Отдел",
  team: "Направление / Команда",
  position: "Должность",
};
type Draft = {
  id?: string;
  name: string;
  unit_type: OrgUnit["unit_type"];
  parent_id: string;
  head_counterparty_id: string;
  result_text: string;
  functions_text: string;
};
const EMPTY: Draft = { name: "", unit_type: "department", parent_id: "", head_counterparty_id: "", result_text: "", functions_text: "" };

export default function OrgUnitManager({
  teamId,
  units,
  employees,
  canManage,
}: {
  teamId: string;
  units: OrgUnit[];
  employees: Emp[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  // Набор СВЁРНУТЫХ узлов (по умолчанию дерево раскрыто).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, OrgUnit[]>();
    for (const u of units) {
      const k = u.parent_id;
      const arr = m.get(k) ?? [];
      arr.push(u);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    return m;
  }, [units]);

  // варианты родителя с отступом по глубине
  const parentOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [{ value: "", label: "— верхний уровень —" }];
    const walk = (pid: string | null, depth: number) => {
      for (const u of childrenOf.get(pid) ?? []) {
        if (draft.id && u.id === draft.id) continue; // нельзя выбрать себя родителем
        out.push({ value: u.id, label: `${"— ".repeat(depth)}${u.name}` });
        walk(u.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [childrenOf, draft.id]);

  function openCreate(parentId: string | null) {
    setDraft({ ...EMPTY, parent_id: parentId ?? "", unit_type: "department" });
    setOpen(true);
  }
  function openEdit(u: OrgUnit) {
    setDraft({
      id: u.id,
      name: u.name,
      unit_type: u.unit_type,
      parent_id: u.parent_id ?? "",
      head_counterparty_id: u.head_counterparty_id ?? "",
      result_text: u.result_text ?? "",
      functions_text: u.functions_text ?? "",
    });
    setOpen(true);
  }

  async function save() {
    if (!draft.name.trim()) {
      toast.error("Укажите название узла");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const payload = {
      name: draft.name.trim(),
      unit_type: draft.unit_type,
      parent_id: draft.parent_id || null,
      head_counterparty_id: draft.head_counterparty_id || null,
      result_text: draft.result_text || null,
      functions_text: draft.functions_text || null,
    };
    const { error } = draft.id
      ? await supabase.from("kb_departments").update(payload).eq("id", draft.id)
      : await supabase.from("kb_departments").insert({ team_id: teamId, ...payload });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Сохранено");
    setOpen(false);
    router.refresh();
  }

  async function remove(u: OrgUnit) {
    if (!confirm(`Удалить узел «${u.name}»? Вложенные узлы и привязки сотрудников будут сняты.`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("kb_departments").delete().eq("id", u.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Удалено");
    router.refresh();
  }

  function toggle(id: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const LINE = "bg-slate-200 dark:bg-white/10";
  // Функции узла → теги-продукты (по строкам/запятым/точкам с запятой).
  const unitTags = (u: OrgUnit) => (u.functions_text ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).slice(0, 8);

  // Карточка узла (Собственники/CEO/отдел) + рекурсивные ветви.
  // 1 ребёнок — «цепочка» со стрелкой вниз; >1 — вертикальный нумерованный список.
  function Node({ u, index }: { u: OrgUnit; index?: number }) {
    const kids = childrenOf.get(u.id) ?? [];
    const isOpen = !collapsed.has(u.id);
    const head = u.head_counterparty_id ? empName.get(u.head_counterparty_id) : null;
    const ts = unitTags(u);
    return (
      <div className="w-full">
        {/* Карточка */}
        <div className="group relative rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.08]">
          <div className="flex items-start gap-3">
            {index != null && (
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-sm font-bold text-brand">{index}</span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[15px] font-extrabold uppercase tracking-tight text-slate-900 dark:text-white">{u.name}</span>
                {kids.length > 0 && (
                  <button type="button" onClick={() => toggle(u.id)} title={isOpen ? "Свернуть" : "Развернуть"} className="shrink-0 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200">
                    {isOpen ? "▾" : `▸${kids.length}`}
                  </button>
                )}
              </div>
              {head && <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand">{head}</div>}
              {ts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ts.map((t, i) => (
                    <span key={i} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-white/[0.06] dark:text-neutral-300">{t}</span>
                  ))}
                </div>
              )}
            </div>
            {canManage && (
              <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
                <button type="button" onClick={() => openCreate(u.id)} title="Добавить внутрь" className="rounded-full px-1.5 text-sm text-slate-400 hover:text-brand">＋</button>
                <button type="button" onClick={() => openEdit(u)} title="Изменить" className="rounded-full px-1.5 text-sm text-slate-400 hover:text-slate-700 dark:hover:text-neutral-200">✎</button>
                <button type="button" onClick={() => remove(u)} title="Удалить" className="rounded-full px-1.5 text-sm text-slate-400 hover:text-red-500">✕</button>
              </div>
            )}
          </div>
        </div>

        {/* Один ребёнок — цепочка со стрелкой */}
        {isOpen && kids.length === 1 && (
          <div className="flex flex-col items-center">
            <div className={`h-4 w-px ${LINE}`} />
            <div className="-mt-1 text-brand">▼</div>
            <div className="mt-1 w-full"><Node u={kids[0]} /></div>
          </div>
        )}

        {/* Несколько детей — вертикальный нумерованный список с левым брекетом */}
        {isOpen && kids.length > 1 && (
          <div className="relative mt-3 space-y-3 pl-7">
            <span className={`absolute left-[10px] top-0 w-px ${LINE}`} style={{ height: "calc(100% - 1.5rem)" }} />
            {kids.map((k, i) => (
              <div key={k.id} className="relative">
                <span className={`absolute -left-[18px] top-6 h-px w-[18px] ${LINE}`} />
                <Node u={k} index={i + 1} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const roots = childrenOf.get(null) ?? [];

  return (
    <section className="surface rounded-3xl p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Оргструктура · отделы</h2>
        {canManage && <button type="button" onClick={() => openCreate(null)} className="btn-primary text-sm">+ Отдел</button>}
      </div>
      {roots.length > 0 ? (
        <div className="mx-auto max-w-xl space-y-4">
          {roots.map((r) => <Node key={r.id} u={r} />)}
        </div>
      ) : (
        <p className="text-sm text-slate-400">Отделов пока нет. Нажмите «+ Отдел», чтобы добавить.</p>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={draft.id ? "Изменить узел" : "Новый узел"} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Название отдела</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="input" placeholder="Например, Медицина / Операционка" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Входит в (необяз.)</span>
              <Select value={draft.parent_id} onChange={(v) => setDraft({ ...draft, parent_id: v })} options={parentOptions} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Руководитель (необяз.)</span>
              <Select value={draft.head_counterparty_id} onChange={(v) => setDraft({ ...draft, head_counterparty_id: v })} options={[{ value: "", label: "— не назначен —" }, ...employees.map((e) => ({ value: e.id, label: e.name }))]} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Результат (ЦКП) — необяз.</span>
            <textarea value={draft.result_text} onChange={(e) => setDraft({ ...draft, result_text: e.target.value })} rows={2} className="input resize-y" placeholder="Ценный конечный продукт узла" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Теги-продукты — необяз.</span>
            <textarea value={draft.functions_text} onChange={(e) => setDraft({ ...draft, functions_text: e.target.value })} rows={3} className="input resize-y" placeholder="Через запятую или по строкам — напр. Ресурсы, Видение, Стратегия" />
            <span className="mt-1 block text-[11px] text-slate-400">Показываются тегами на карточке отдела/роли.</span>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Отмена</button>
            <button type="button" disabled={busy} onClick={save} className="btn-primary">{busy ? "…" : "Сохранить"}</button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
