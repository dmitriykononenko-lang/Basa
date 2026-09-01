"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Select } from "@/components/ui/select";
import Combobox from "@/components/Combobox";
import { toast } from "@/lib/toast";

export type Cond = { field: "counterparty" | "note" | "type" | "account"; op: "eq" | "contains"; value: string };
export type Action = { type: "set_category" | "set_project" | "make_transfer"; value: string };
export type Rule = { id: string; enabled: boolean; conditions: Cond[]; action: Action };

type Named = { id: string; name: string };
type Cat = { id: string; name: string; kind: "income" | "expense" };

const FIELDS: { value: Cond["field"]; label: string }[] = [
  { value: "counterparty", label: "Контрагент" },
  { value: "note", label: "Назначение платежа" },
  { value: "type", label: "Тип операции" },
  { value: "account", label: "Счёт" },
];
const ACTIONS: { value: Action["type"]; label: string }[] = [
  { value: "set_category", label: "Поставить статью" },
  { value: "set_project", label: "Отнести к проекту" },
  { value: "make_transfer", label: "Сделать переводом на счёт" },
];
const TYPE_OPTS = [{ value: "income", label: "Приход" }, { value: "expense", label: "Расход" }];

export default function RulesManager({
  rules, counterparties, categories, projects, accounts, teamId, canEdit,
}: {
  rules: Rule[];
  counterparties: Named[];
  categories: Cat[];
  projects: Named[];
  accounts: Named[];
  teamId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [q, setQ] = useState("");

  const cpName = useMemo(() => new Map(counterparties.map((c) => [c.id, c.name])), [counterparties]);
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const projName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const accName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);

  function condText(c: Cond): string {
    if (c.field === "counterparty") return `контрагент — ${cpName.get(c.value) ?? "?"}`;
    if (c.field === "account") return `счёт — ${accName.get(c.value) ?? "?"}`;
    if (c.field === "type") return c.value === "income" ? "это поступление" : "это списание";
    return `назначение содержит «${c.value}»`;
  }
  function actionText(a: Action): string {
    if (a.type === "set_category") return `поставить статью «${catName.get(a.value) ?? "?"}»`;
    if (a.type === "set_project") return `отнести к проекту «${projName.get(a.value) ?? "?"}»`;
    return `сделать переводом на счёт «${accName.get(a.value) ?? "?"}»`;
  }
  function ruleText(r: Rule): string {
    const conds = r.conditions.filter((c) => c.value).map(condText).join(" и ");
    return `Если ${conds || "(условия не заданы)"}, то ${actionText(r.action)}`;
  }

  async function toggle(r: Rule) {
    const supabase = createClient();
    await supabase.from("automation_rules").update({ enabled: !r.enabled }).eq("id", r.id);
    router.refresh();
  }

  const filtered = q.trim()
    ? rules.filter((r) => ruleText(r).toLowerCase().includes(q.trim().toLowerCase()))
    : rules;

  if (editing) {
    return (
      <RuleEditor
        rule={editing === "new" ? null : editing}
        counterparties={counterparties} categories={categories} projects={projects} accounts={accounts}
        teamId={teamId}
        onClose={() => setEditing(null)}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {canEdit && <button onClick={() => setEditing("new")} className="btn-primary">+ Добавить правило</button>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по правилам…" className="input max-w-sm flex-1 py-2 text-sm" />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          {rules.length === 0 ? "Пока нет правил. Добавьте первое — и операции будут размечаться автоматически." : "Ничего не найдено."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          {filtered.map((r) => (
            <div key={r.id} className="flex items-start gap-3 border-b border-slate-50 px-5 py-4 last:border-0 dark:border-white/[0.05]">
              {canEdit && (
                <button onClick={() => toggle(r)} title={r.enabled ? "Выключить" : "Включить"}
                  className={`mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition ${r.enabled ? "bg-brand" : "bg-slate-200 dark:bg-neutral-700"}`}>
                  <span className={`block h-4 w-4 rounded-full bg-white transition ${r.enabled ? "translate-x-4" : ""}`} />
                </button>
              )}
              <p className={`flex-1 text-sm ${r.enabled ? "text-slate-700 dark:text-neutral-200" : "text-slate-400 line-through dark:text-neutral-600"}`}>
                {ruleSentence(r, condText, actionText)}
              </p>
              {canEdit && (
                <button onClick={() => setEditing(r)} className="shrink-0 text-xs font-medium text-brand hover:underline">Изменить</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Подсветка ключевых значений жирным в предложении правила
function ruleSentence(r: Rule, condText: (c: Cond) => string, actionText: (a: Action) => string) {
  const conds = r.conditions.filter((c) => c.value);
  return (
    <>
      Если{" "}
      {conds.length === 0 ? <b>(условия не заданы)</b> : conds.map((c, i) => (
        <span key={i}>{i > 0 && " и "}<b>{condText(c)}</b></span>
      ))}
      , то <b>{actionText(r.action)}</b>
    </>
  );
}

function RuleEditor({
  rule, counterparties, categories, projects, accounts, teamId, onClose,
}: {
  rule: Rule | null;
  counterparties: Named[];
  categories: Cat[];
  projects: Named[];
  accounts: Named[];
  teamId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [conditions, setConditions] = useState<Cond[]>(rule?.conditions?.length ? rule.conditions : [{ field: "counterparty", op: "eq", value: "" }]);
  const [action, setAction] = useState<Action>(rule?.action ?? { type: "set_category", value: "" });
  const [applyExisting, setApplyExisting] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setCond(i: number, patch: Partial<Cond>) {
    setConditions((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    setPreview(null);
  }
  function addCond() { setConditions((prev) => [...prev, { field: "note", op: "contains", value: "" }]); }
  function removeCond(i: number) { setConditions((prev) => prev.filter((_, j) => j !== i)); setPreview(null); }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildQuery(base: any) {
    let q = base.eq("team_id", teamId).eq("status", "actual");
    let hasType = false;
    for (const c of conditions) {
      if (!c.value) continue;
      if (c.field === "counterparty") q = q.eq("counterparty_id", c.value);
      else if (c.field === "account") q = q.eq("account_id", c.value);
      else if (c.field === "type") { q = q.eq("type", c.value); hasType = true; }
      else if (c.field === "note") q = q.ilike("note", `%${c.value}%`);
    }
    if (action.type === "make_transfer" && !hasType) q = q.in("type", ["income", "expense"]);
    return q;
  }

  async function runPreview() {
    setBusy(true); setError(null);
    const supabase = createClient();
    const { count, error } = await buildQuery(supabase.from("transactions").select("id", { count: "exact", head: true }));
    setBusy(false);
    if (error) return setError(error.message);
    setPreview(count ?? 0);
  }

  async function save() {
    if (!action.value) return setError("Выберите значение действия");
    if (!conditions.some((c) => c.value)) return setError("Добавьте хотя бы одно условие");
    setBusy(true); setError(null);
    const supabase = createClient();
    const payload = { team_id: teamId, conditions, action, enabled: true };
    const res = rule
      ? await supabase.from("automation_rules").update({ conditions, action }).eq("id", rule.id)
      : await supabase.from("automation_rules").insert(payload);
    if (res.error) { setBusy(false); return setError(res.error.message); }

    if (applyExisting) {
      const patch =
        action.type === "set_category" ? { category_id: action.value }
        : action.type === "set_project" ? { project_id: action.value }
        : { type: "transfer", transfer_account_id: action.value, category_id: null, counterparty_id: null };
      const { error } = await buildQuery(supabase.from("transactions").update(patch));
      if (error) { setBusy(false); return setError(error.message); }
    }
    setBusy(false);
    toast.success(rule ? "Правило обновлено" : "Правило создано");
    onClose();
    router.refresh();
  }

  async function remove() {
    if (!rule || !confirm("Удалить правило?")) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.from("automation_rules").delete().eq("id", rule.id);
    setBusy(false);
    toast.success("Правило удалено");
    onClose();
    router.refresh();
  }

  const valueEditor = (c: Cond, i: number) => {
    if (c.field === "counterparty") return <Combobox className="min-w-[220px] flex-1" value={c.value} onChange={(v) => setCond(i, { value: v })} placeholder="— контрагент —" options={counterparties.map((x) => ({ value: x.id, label: x.name }))} />;
    if (c.field === "account") return <Combobox className="min-w-[220px] flex-1" value={c.value} onChange={(v) => setCond(i, { value: v })} placeholder="— счёт —" options={accounts.map((x) => ({ value: x.id, label: x.name }))} />;
    if (c.field === "type") return <Select className="min-w-[200px] flex-1" value={c.value} onChange={(v) => setCond(i, { value: v })} placeholder="— тип —" options={TYPE_OPTS} />;
    return <input value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} placeholder="текст в назначении" className="input min-w-[220px] flex-1" />;
  };

  return (
    <div className="max-w-3xl rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">{rule ? "Правило" : "Новое правило"}</h2>

      <div className="mb-1 text-sm font-semibold text-slate-700 dark:text-neutral-200">Если выполняются все условия</div>
      <div className="space-y-2">
        {conditions.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select className="w-52" value={c.field} onChange={(v) => setCond(i, { field: v as Cond["field"], op: v === "note" ? "contains" : "eq", value: "" })} options={FIELDS} />
            {c.field === "note" && <span className="text-sm text-slate-400">содержит</span>}
            {valueEditor(c, i)}
            <button onClick={() => removeCond(i)} className="rounded-lg px-2 py-2 text-slate-400 hover:text-red-500" title="Удалить условие">✕</button>
          </div>
        ))}
      </div>
      <button onClick={addCond} className="mt-2 text-sm font-medium text-brand hover:underline">+ Добавить условие</button>

      <div className="mb-1 mt-6 text-sm font-semibold text-slate-700 dark:text-neutral-200">Тогда выполнить действие</div>
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-64" value={action.type} onChange={(v) => setAction({ type: v as Action["type"], value: "" })} options={ACTIONS} />
        {action.type === "set_category" && <Combobox className="min-w-[220px] flex-1" value={action.value} onChange={(v) => setAction({ ...action, value: v })} placeholder="— статья —" options={categories.map((x) => ({ value: x.id, label: x.name }))} />}
        {action.type === "set_project" && <Combobox className="min-w-[220px] flex-1" value={action.value} onChange={(v) => setAction({ ...action, value: v })} placeholder="— проект —" options={projects.map((x) => ({ value: x.id, label: x.name }))} />}
        {action.type === "make_transfer" && <Combobox className="min-w-[220px] flex-1" value={action.value} onChange={(v) => setAction({ ...action, value: v })} placeholder="— счёт —" options={accounts.map((x) => ({ value: x.id, label: x.name }))} />}
      </div>

      <label className="mt-5 flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-neutral-200">
        <input type="checkbox" checked={applyExisting} onChange={(e) => setApplyExisting(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" />
        Применить правило к существующим операциям
      </label>

      <div className="mt-3">
        <button onClick={runPreview} disabled={busy} className="text-sm font-medium text-slate-500 hover:text-brand dark:text-neutral-400">
          👁 Посмотреть, сколько операций попадёт под правило
        </button>
        {preview != null && <span className="ml-2 text-sm font-semibold text-slate-700 dark:text-neutral-200">→ {preview}</span>}
      </div>

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}

      <div className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4 dark:border-white/[0.06]">
        <button onClick={save} disabled={busy} className="btn-primary">{busy ? "…" : "Сохранить"}</button>
        <button onClick={onClose} className="btn-ghost">Отмена</button>
        {rule && <button onClick={remove} disabled={busy} className="ml-auto rounded-full px-4 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-500/10">Удалить</button>}
      </div>
    </div>
  );
}
