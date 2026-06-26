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
const TYPE_BADGE: Record<OrgUnit["unit_type"], string> = {
  department: "bg-brand/10 text-brand",
  division: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300",
  team: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300",
  position: "bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400",
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
    setDraft({ ...EMPTY, parent_id: parentId ?? "", unit_type: parentId ? "position" : "department" });
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
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function Node({ u, depth }: { u: OrgUnit; depth: number }) {
    const kids = childrenOf.get(u.id) ?? [];
    const isOpen = expanded.has(u.id);
    const hasDetails = !!(u.result_text || u.functions_text) || kids.length > 0;
    return (
      <li>
        <div
          className="flex items-center gap-2 rounded-2xl px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/[0.03]"
          style={{ marginLeft: depth * 16 }}
        >
          <button type="button" onClick={() => toggle(u.id)} className={`w-4 text-slate-400 ${hasDetails ? "" : "opacity-0"}`}>
            {isOpen ? "▾" : "▸"}
          </button>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE_BADGE[u.unit_type]}`}>{UNIT_TYPE_LABELS[u.unit_type]}</span>
          <span className="font-medium text-slate-800 dark:text-neutral-200">{u.name}</span>
          {u.head_counterparty_id && <span className="text-xs text-slate-400">· рук.: {empName.get(u.head_counterparty_id) ?? "—"}</span>}
          {canManage && (
            <span className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => openCreate(u.id)} className="btn-ghost px-2 py-1 text-xs" title="Добавить подузел">+ Подузел</button>
              <button type="button" onClick={() => openEdit(u)} className="btn-ghost px-2 py-1 text-xs">Изменить</button>
              <button type="button" onClick={() => remove(u)} className="btn-ghost px-2 py-1 text-xs">Удалить</button>
            </span>
          )}
        </div>
        {isOpen && (u.result_text || u.functions_text) && (
          <div className="mb-1 space-y-1 rounded-2xl bg-slate-50 px-4 py-2 text-xs text-slate-600 dark:bg-white/[0.03] dark:text-neutral-400" style={{ marginLeft: depth * 16 + 24 }}>
            {u.result_text && <div><span className="font-semibold text-slate-500">Результат (ЦКП):</span> {u.result_text}</div>}
            {u.functions_text && <div className="whitespace-pre-wrap"><span className="font-semibold text-slate-500">Функции:</span> {u.functions_text}</div>}
          </div>
        )}
        {isOpen && kids.length > 0 && <ul>{kids.map((k) => <Node key={k.id} u={k} depth={depth + 1} />)}</ul>}
      </li>
    );
  }

  const roots = childrenOf.get(null) ?? [];

  return (
    <section className="surface rounded-3xl p-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Орг-схема</h2>
        {canManage && <button type="button" onClick={() => openCreate(null)} className="btn-primary text-sm">+ Узел</button>}
      </div>
      {roots.length > 0 ? (
        <ul>{roots.map((r) => <Node key={r.id} u={r} depth={0} />)}</ul>
      ) : (
        <p className="text-sm text-slate-400">Узлов пока нет. Создайте департамент, затем отделы, направления и должности.</p>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={draft.id ? "Изменить узел" : "Новый узел"} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Название</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="input" placeholder="Например, Отдел разработки" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Тип узла</span>
              <Select value={draft.unit_type} onChange={(v) => setDraft({ ...draft, unit_type: v as OrgUnit["unit_type"] })} options={(Object.keys(UNIT_TYPE_LABELS) as OrgUnit["unit_type"][]).map((t) => ({ value: t, label: UNIT_TYPE_LABELS[t] }))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Родитель</span>
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
