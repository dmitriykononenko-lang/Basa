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

  // Узел-карточка + рекурсивные ветви (дерево сверху-вниз, в фирменной теме).
  function Node({ u, depth }: { u: OrgUnit; depth: number }) {
    const kids = childrenOf.get(u.id) ?? [];
    const isOpen = !collapsed.has(u.id);
    const isRoot = depth === 0;
    const head = u.head_counterparty_id ? empName.get(u.head_counterparty_id) : null;
    const subtitle = head ? `рук.: ${head}` : "Отдел";
    return (
      <div className="flex flex-col items-center">
        {/* Карточка */}
        <div className="group relative">
          <div className={`flex min-w-[160px] max-w-[260px] items-center gap-2.5 rounded-2xl px-4 py-3 shadow-sm ring-1 transition ${isRoot ? "bg-brand text-white ring-brand/30" : "bg-white text-slate-800 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-100 dark:ring-white/[0.08]"}`}>
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${isRoot ? "bg-white/20 text-white" : "bg-brand/10 text-brand"}`}>
              {u.name.trim().charAt(0).toUpperCase() || "•"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold leading-tight">{u.name}</span>
              <span className={`block truncate text-[11px] leading-tight ${isRoot ? "text-white/70" : "text-slate-400 dark:text-neutral-500"}`}>{subtitle}</span>
            </span>
            {kids.length > 0 && (
              <button type="button" onClick={() => toggle(u.id)} title={isOpen ? "Свернуть" : "Развернуть"} className={`shrink-0 rounded-full px-1 text-xs ${isRoot ? "text-white/80 hover:text-white" : "text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200"}`}>
                {isOpen ? "▾" : `▸${kids.length}`}
              </button>
            )}
          </div>
          {canManage && (
            <div className="absolute -right-1 -top-2 z-10 flex gap-0.5 rounded-full bg-white p-0.5 opacity-0 shadow ring-1 ring-slate-200 transition group-hover:opacity-100 dark:bg-[#1b1d22] dark:ring-white/10">
              <button type="button" onClick={() => openCreate(u.id)} title="Добавить отдел" className="rounded-full px-1.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-brand dark:text-neutral-300 dark:hover:bg-white/10">＋</button>
              <button type="button" onClick={() => openEdit(u)} title="Изменить" className="rounded-full px-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/10">✎</button>
              <button type="button" onClick={() => remove(u)} title="Удалить" className="rounded-full px-1.5 text-xs text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">✕</button>
            </div>
          )}
        </div>

        {/* Ветви */}
        {isOpen && kids.length > 0 && (
          <div className="flex flex-col items-center">
            {/* Ствол от карточки к шине */}
            <div className={`relative w-px ${isRoot ? "h-10" : "h-6"} ${LINE}`}>
              {isRoot && (
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">↓ сверху вниз</span>
              )}
            </div>
            {/* Ряд детей с соединителями */}
            <div className="flex items-start">
              {kids.map((k, i) => (
                <div key={k.id} className="relative flex flex-col items-center px-3 pt-6">
                  <span className={`absolute left-1/2 top-0 h-6 w-px -translate-x-1/2 ${LINE}`} />
                  {kids.length > 1 && (
                    <span className={`absolute top-0 h-px ${LINE} ${i === 0 ? "left-1/2 right-0" : i === kids.length - 1 ? "left-0 right-1/2" : "left-0 right-0"}`} />
                  )}
                  <Node u={k} depth={depth + 1} />
                </div>
              ))}
            </div>
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
        <div className="overflow-x-auto pb-4">
          <div className="flex min-w-full justify-center gap-10 px-4 pt-2">
            {roots.map((r) => <Node key={r.id} u={r} depth={0} />)}
          </div>
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
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Функции — необяз.</span>
            <textarea value={draft.functions_text} onChange={(e) => setDraft({ ...draft, functions_text: e.target.value })} rows={3} className="input resize-y" placeholder="Список функций (по строкам)" />
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
