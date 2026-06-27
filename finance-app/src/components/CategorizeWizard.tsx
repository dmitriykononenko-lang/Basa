"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";
import Combobox from "@/components/Combobox";

export type WizardOp = {
  id: string;
  type: "income" | "expense";
  amount: number;
  currency: string;
  occurred_on: string;
  note: string | null;
  counterpartyId: string | null;
  accountName: string | null;
  counterpartyName: string | null;
};
export type WizardCat = { id: string; name: string; kind: "income" | "expense"; freq?: number };

export default function CategorizeWizard({
  ops, categories, projects, suggestionByCp, teamId, canEdit,
}: {
  ops: WizardOp[];
  categories: WizardCat[];
  projects: { id: string; name: string }[];
  suggestionByCp: Record<string, string>;
  teamId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [cats, setCats] = useState(categories);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [ptr, setPtr] = useState(0);
  const [q, setQ] = useState("");
  const [byProject, setByProject] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const pending = useMemo(() => ops.filter((o) => !assigned.has(o.id)), [ops, assigned]);
  const total = ops.length;
  const doneCount = assigned.size;

  if (pending.length === 0) {
    return (
      <div className="rounded-3xl bg-white p-10 text-center ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <div className="text-2xl">🎉</div>
        <p className="mt-2 text-sm font-medium text-slate-700 dark:text-neutral-200">Готово! Распределено {doneCount} операций</p>
        <button onClick={() => router.refresh()} className="btn-ghost mt-3">Обновить</button>
      </div>
    );
  }

  const pos = ptr % pending.length;
  const op = pending[pos];
  const kindCats = cats.filter((c) => c.kind === op.type);
  const suggestId = op.counterpartyId ? suggestionByCp[op.counterpartyId] : undefined;
  const suggest = suggestId && catById.get(suggestId)?.kind === op.type ? catById.get(suggestId) : undefined;

  const ql = q.trim().toLowerCase();
  const searchResults = ql ? kindCats.filter((c) => c.name.toLowerCase().includes(ql)) : [];
  const exactExists = kindCats.some((c) => c.name.toLowerCase() === ql);

  // Топ-чипы: подсказка + самые частые статьи нужного типа
  const chips: WizardCat[] = [];
  if (suggest) chips.push(suggest);
  for (const c of kindCats) {
    if (chips.length >= 8) break;
    if (!chips.find((x) => x.id === c.id)) chips.push(c);
  }

  async function assign(categoryId: string) {
    if (!canEdit) return;
    setBusy(true);
    const supabase = createClient();
    const patch: Record<string, string | null> = { category_id: categoryId };
    if (byProject) patch.project_id = projectId || null;
    const { error } = await supabase.from("transactions").update(patch).eq("id", op.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setAssigned((prev) => new Set(prev).add(op.id));
    setQ("");
  }

  async function createAndAssign() {
    if (!canEdit || !q.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("categories")
      .insert({ team_id: teamId, name: q.trim(), kind: op.type })
      .select("id, name, kind")
      .single();
    if (error || !data) { setBusy(false); toast.error(error?.message ?? "Не удалось создать статью"); return; }
    setCats((prev) => [...prev, data as WizardCat]);
    const patch: Record<string, string | null> = { category_id: data.id };
    if (byProject) patch.project_id = projectId || null;
    await supabase.from("transactions").update(patch).eq("id", op.id);
    setBusy(false);
    setAssigned((prev) => new Set(prev).add(op.id));
    setQ("");
    toast.success(`Статья «${data.name}» создана`);
  }

  function skip() {
    setQ("");
    setPtr((p) => p + 1);
  }

  async function autoDistribute() {
    if (!canEdit) return;
    const groups = new Map<string, string[]>();
    for (const o of pending) {
      const sid = o.counterpartyId ? suggestionByCp[o.counterpartyId] : undefined;
      if (!sid) continue;
      if (catById.get(sid)?.kind !== o.type) continue;
      const arr = groups.get(sid) ?? [];
      arr.push(o.id);
      groups.set(sid, arr);
    }
    const ids = [...groups.values()].flat();
    if (ids.length === 0) { toast("Нет уверенных подсказок по контрагентам"); return; }
    setBusy(true);
    const supabase = createClient();
    for (const [catId, list] of groups) {
      await supabase.from("transactions").update({ category_id: catId }).in("id", list);
    }
    setBusy(false);
    setAssigned((prev) => { const n = new Set(prev); ids.forEach((i) => n.add(i)); return n; });
    toast.success(`Распределено автоматически: ${ids.length}`);
  }

  const amountColor = op.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
          {pending.length} {plural(pending.length, "операция", "операции", "операций")} осталось
        </div>
        {canEdit && (
          <button onClick={autoDistribute} disabled={busy} className="flex items-center gap-1.5 text-sm font-medium text-brand transition hover:opacity-80 disabled:opacity-50">
            ✨ Распределять автоматически
          </button>
        )}
      </div>

      {/* Карточка операции */}
      <div className="relative rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <div className="flex items-center gap-3 text-sm text-slate-400 dark:text-neutral-500">
          <span>{formatDate(op.occurred_on)}</span>
          {op.accountName && <span>· {op.accountName}</span>}
          {op.counterpartyName && <span className="truncate">· {op.counterpartyName}</span>}
        </div>
        <div className={`mt-2 text-4xl font-extrabold tabular-nums ${amountColor}`}>
          {op.type === "income" ? "+" : "−"}{formatMoney(op.amount, op.currency)}
        </div>
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:bg-white/[0.03] dark:text-neutral-400">
          {op.note || "Назначение платежа не указано"}
        </div>

        <button onClick={skip} disabled={busy} title="Пропустить"
          className="absolute -right-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white text-slate-400 shadow-md ring-1 ring-slate-200 transition hover:text-brand disabled:opacity-50 dark:bg-[#1b1d22] dark:ring-white/10 sm:flex">
          →
        </button>
      </div>

      {/* Выбор статьи */}
      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-800 dark:text-neutral-100">Какая статья соответствует операции?</h3>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-neutral-300">
            <input type="checkbox" checked={byProject} onChange={(e) => setByProject(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" />
            Распределять по проектам
          </label>
        </div>

        {byProject && (
          <div className="mb-3 max-w-sm">
            <Combobox value={projectId} onChange={setProjectId} placeholder="— проект не выбран —" emptyLabel="— без проекта —"
              options={projects.map((p) => ({ value: p.id, label: p.name }))} />
          </div>
        )}

        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти или создать…" className="input mb-3" disabled={!canEdit} />

        {ql ? (
          <div className="flex flex-wrap gap-2">
            {searchResults.map((c) => (
              <Chip key={c.id} onClick={() => assign(c.id)} disabled={busy}>{c.name}</Chip>
            ))}
            {!exactExists && (
              <button onClick={createAndAssign} disabled={busy}
                className="rounded-full bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition hover:bg-brand/20 disabled:opacity-50">
                + Создать «{q.trim()}»
              </button>
            )}
            {searchResults.length === 0 && exactExists && <span className="text-sm text-slate-400">Статья уже есть выше</span>}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <Chip key={c.id} onClick={() => assign(c.id)} disabled={busy} highlight={c.id === suggest?.id}>
                {c.id === suggest?.id && "✨ "}{c.name}
              </Chip>
            ))}
            {chips.length === 0 && <span className="text-sm text-slate-400">Нет статей типа «{op.type === "income" ? "доход" : "расход"}» — введите название, чтобы создать</span>}
          </div>
        )}
      </div>

      <div className="mt-5 h-1.5 w-full rounded-full bg-slate-100 dark:bg-white/[0.06]">
        <div className="h-1.5 rounded-full bg-brand transition-all" style={{ width: `${(doneCount / total) * 100}%` }} />
      </div>
    </div>
  );
}

function Chip({ children, onClick, disabled, highlight }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; highlight?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`rounded-full px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
        highlight
          ? "bg-brand/15 text-brand ring-1 ring-brand/30 hover:bg-brand/25"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-neutral-300 dark:hover:bg-white/[0.1]"
      }`}>
      {children}
    </button>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
