"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDate, formatMoney } from "@/lib/format";
import { toast } from "@/lib/toast";
import Combobox, { type ComboOption } from "@/components/Combobox";
import EditableTransactionRow, { type TxData } from "@/components/EditableTransactionRow";
import type { Attachment } from "@/components/Attachments";
import type { RateMap } from "@/lib/fx";

function daysApart(a: string, b: string) {
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

type Account = { id: string; name: string; currency: string };
type Named = { id: string; name: string; inn?: string | null };
type Category = { id: string; name: string; kind: "income" | "expense" };
type Item = { tx: TxData; editable: boolean; attachments: Attachment[] };

export default function OperationsTable({
  items,
  accounts,
  categories,
  counterparties,
  projects,
  teamId,
  userId,
  displayBase,
  rates,
}: {
  items: Item[];
  accounts: Account[];
  categories: Category[];
  counterparties: Named[];
  projects: Named[];
  teamId: string;
  userId: string;
  // Показывать суммы в иной валюте в базовой (единообразие, напр. в drilldown ДДС).
  displayBase?: string;
  rates?: RateMap;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [mergeBusy, setMergeBusy] = useState(false);

  // bulk-edit значения
  const [bCat, setBCat] = useState("");
  const [bProj, setBProj] = useState("");
  const [bCp, setBCp] = useState("");
  const [bAcc, setBAcc] = useState("");
  const [bStatus, setBStatus] = useState("keep");

  const editableIds = useMemo(() => items.filter((i) => i.editable).map((i) => i.tx.id), [items]);
  const today = new Date().toISOString().slice(0, 10);

  const groups = useMemo(() => {
    const g: { date: string; items: Item[] }[] = [];
    for (const it of items) {
      const last = g[g.length - 1];
      if (last && last.date === it.tx.occurred_on) last.items.push(it);
      else g.push({ date: it.tx.occurred_on, items: [it] });
    }
    return g;
  }, [items]);

  // Авто-детекция переводов: расход с одного счёта ↔ приход на другой (та же сумма/валюта, близкие даты)
  const transferCandidates = useMemo(() => {
    const incomes = items.filter((i) => i.editable && i.tx.type === "income" && i.tx.account_id);
    const expenses = items.filter((i) => i.editable && i.tx.type === "expense" && i.tx.account_id);
    const usedInc = new Set<string>();
    const pairs: { exp: TxData; inc: TxData; key: string }[] = [];
    for (const e of expenses) {
      const et = e.tx;
      const m = incomes.find((i) =>
        !usedInc.has(i.tx.id) &&
        i.tx.amount === et.amount &&
        i.tx.currency === et.currency &&
        i.tx.account_id !== et.account_id &&
        i.tx.status === et.status &&
        daysApart(i.tx.occurred_on, et.occurred_on) <= 3
      );
      if (m) {
        usedInc.add(m.tx.id);
        pairs.push({ exp: et, inc: m.tx, key: `${et.id}|${m.tx.id}` });
      }
    }
    return pairs.filter((p) => !dismissed.has(p.key));
  }, [items, dismissed]);

  async function mergePair(exp: TxData, inc: TxData) {
    setMergeBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error: insErr } = await supabase.from("transactions").insert({
      team_id: teamId,
      type: "transfer",
      amount: exp.amount,
      currency: exp.currency,
      account_id: exp.account_id,
      transfer_account_id: inc.account_id,
      occurred_on: exp.occurred_on,
      status: exp.status,
      created_by: userId,
    });
    if (insErr) { setMergeBusy(false); return setErr(insErr.message); }
    const { error: delErr } = await supabase.from("transactions").delete().in("id", [exp.id, inc.id]);
    setMergeBusy(false);
    if (delErr) return setErr(delErr.message);
    toast.success("Объединено в перевод");
    router.refresh();
  }

  async function mergeAll() {
    if (!confirm(`Объединить найденные пары в переводы (${transferCandidates.length})?`)) return;
    setMergeBusy(true);
    setErr(null);
    const supabase = createClient();
    for (const p of transferCandidates) {
      const { error: insErr } = await supabase.from("transactions").insert({
        team_id: teamId, type: "transfer", amount: p.exp.amount, currency: p.exp.currency,
        account_id: p.exp.account_id, transfer_account_id: p.inc.account_id,
        occurred_on: p.exp.occurred_on, status: p.exp.status, created_by: userId,
      });
      if (insErr) { setMergeBusy(false); return setErr(insErr.message); }
      const { error: delErr } = await supabase.from("transactions").delete().in("id", [p.exp.id, p.inc.id]);
      if (delErr) { setMergeBusy(false); return setErr(delErr.message); }
    }
    setMergeBusy(false);
    toast.success(`Создано переводов: ${transferCandidates.length}`);
    router.refresh();
  }

  function toggle(id: string) {
    setSel((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSel((p) => (p.size === editableIds.length ? new Set() : new Set(editableIds)));
  }
  function clear() {
    setSel(new Set());
    setPanel(false);
  }

  const selected = [...sel];
  const selItems = items.filter((i) => sel.has(i.tx.id)).map((i) => i.tx);
  const incomes = selItems.filter((t) => t.type === "income");
  const expenses = selItems.filter((t) => t.type === "expense");
  const canTransfer = incomes.length === 1 && expenses.length === 1;

  async function applyBulk() {
    setErr(null);
    const patch: Record<string, unknown> = {};
    if (bCat) patch.category_id = bCat;
    if (bProj) patch.project_id = bProj;
    if (bCp) patch.counterparty_id = bCp;
    if (bAcc) patch.account_id = bAcc;
    if (bStatus !== "keep") patch.status = bStatus;
    if (Object.keys(patch).length === 0) return setErr("Выберите хотя бы одно поле");
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("transactions").update(patch).in("id", selected);
    setBusy(false);
    if (error) { toast.error(error.message); return setErr(error.message); }
    setBCat(""); setBProj(""); setBCp(""); setBAcc(""); setBStatus("keep");
    clear();
    toast.success(`Обновлено операций: ${selected.length}`);
    router.refresh();
  }

  async function bulkDelete() {
    if (!confirm(`Удалить выбранные операции (${selected.length})?`)) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("transactions").delete().in("id", selected);
    setBusy(false);
    if (error) { toast.error(error.message); return setErr(error.message); }
    clear();
    toast.success("Операции удалены");
    router.refresh();
  }

  async function toTransfer() {
    if (!canTransfer) return;
    const e = expenses[0];
    const i = incomes[0];
    if (e.currency !== i.currency && !confirm("Валюты расхода и прихода разные. Перевод будет на сумму расхода в его валюте. Продолжить?")) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error: insErr } = await supabase.from("transactions").insert({
      team_id: teamId,
      type: "transfer",
      amount: e.amount,
      currency: e.currency,
      account_id: e.account_id,
      transfer_account_id: i.account_id,
      occurred_on: e.occurred_on,
      status: e.status,
      created_by: userId,
    });
    if (insErr) { setBusy(false); return setErr(insErr.message); }
    const { error: delErr } = await supabase.from("transactions").delete().in("id", [e.id, i.id]);
    setBusy(false);
    if (delErr) return setErr(delErr.message);
    clear();
    toast.success("Создан перевод между счетами");
    router.refresh();
  }

  const cpOpts: ComboOption[] = counterparties.map((c) => ({ value: c.id, label: c.name, search: `${c.name} ${c.inn ?? ""}` }));

  return (
    <div>
      {transferCandidates.length > 0 && (
        <div className="mb-3 rounded-2xl bg-violet-50 p-4 ring-1 ring-violet-200 dark:bg-violet-950/20 dark:ring-violet-900/40">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-violet-800 dark:text-violet-200">
              ⇄ Похоже на переводы между счетами: {transferCandidates.length}
            </span>
            <button onClick={mergeAll} disabled={mergeBusy} className="rounded-full bg-violet-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
              Объединить все
            </button>
          </div>
          <div className="space-y-1.5">
            {transferCandidates.slice(0, 6).map((p) => (
              <div key={p.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-slate-600 dark:text-neutral-300">
                  {formatMoney(p.exp.amount, p.exp.currency)} · «{p.exp.accountName}» → «{p.inc.accountName}» · {formatDate(p.exp.occurred_on)}
                </span>
                <span className="flex gap-2">
                  <button onClick={() => mergePair(p.exp, p.inc)} disabled={mergeBusy} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-violet-700 ring-1 ring-violet-300 disabled:opacity-50 dark:bg-white/[0.06] dark:text-violet-300">
                    Объединить
                  </button>
                  <button onClick={() => setDismissed((d) => new Set(d).add(p.key))} className="rounded-full px-2 py-1 text-xs text-slate-400 hover:text-slate-600">
                    Скрыть
                  </button>
                </span>
              </div>
            ))}
            {transferCandidates.length > 6 && (
              <p className="text-xs text-violet-600/70 dark:text-violet-300/60">…и ещё {transferCandidates.length - 6}. «Объединить все» обработает их все.</p>
            )}
          </div>
        </div>
      )}

      {sel.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-brand/5 px-4 py-2 ring-1 ring-brand/20">
          <span className="text-sm font-medium text-slate-700 dark:text-neutral-200">Выбрано: {sel.size}</span>
          <button onClick={() => setPanel((p) => !p)} className="rounded-full bg-white px-3 py-1 text-sm text-brand ring-1 ring-brand/30 dark:bg-white/[0.06]">Изменить</button>
          {canTransfer && (
            <button onClick={toTransfer} disabled={busy} className="rounded-full bg-white px-3 py-1 text-sm text-brand ring-1 ring-brand/30 dark:bg-white/[0.06]">⇄ В перевод</button>
          )}
          <button onClick={bulkDelete} disabled={busy} className="rounded-full px-3 py-1 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">Удалить</button>
          <button onClick={clear} className="rounded-full px-3 py-1 text-sm text-slate-400 hover:text-slate-600">Снять выделение</button>
          {err && <span className="text-sm text-red-500">{err}</span>}
        </div>
      )}

      {panel && sel.size > 0 && (
        <div className="mb-3 grid grid-cols-2 items-end gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07] sm:grid-cols-3 lg:grid-cols-5">
          <L label="Статья"><Combobox value={bCat} onChange={setBCat} placeholder="не менять" emptyLabel="не менять" options={categories.map((c) => ({ value: c.id, label: c.name }))} /></L>
          <L label="Проект"><Combobox value={bProj} onChange={setBProj} placeholder="не менять" emptyLabel="не менять" options={projects.map((p) => ({ value: p.id, label: p.name }))} /></L>
          <L label="Контрагент"><Combobox value={bCp} onChange={setBCp} placeholder="не менять" emptyLabel="не менять" options={cpOpts} /></L>
          <L label="Счёт"><Combobox value={bAcc} onChange={setBAcc} placeholder="не менять" emptyLabel="не менять" options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></L>
          <L label="Статус">
            <select value={bStatus} onChange={(e) => setBStatus(e.target.value)} className="input">
              <option value="keep">не менять</option>
              <option value="actual">Фактическая</option>
              <option value="planned">Плановая</option>
            </select>
          </L>
          <div className="col-span-2 sm:col-span-3 lg:col-span-5">
            <button onClick={applyBulk} disabled={busy} className="btn-primary">{busy ? "…" : `Применить к ${sel.size}`}</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
              <th className="px-3 py-3">
                {editableIds.length > 0 && (
                  <input type="checkbox" checked={sel.size === editableIds.length && editableIds.length > 0} onChange={toggleAll} className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" />
                )}
              </th>
              <th className="px-5 py-3 font-medium">Дата</th>
              <th className="px-5 py-3 font-medium">Операция</th>
              <th className="px-5 py-3 font-medium">Статья / Описание</th>
              <th className="px-5 py-3 font-medium">Проект</th>
              <th className="px-5 py-3 font-medium">Контрагент</th>
              <th className="px-5 py-3 font-medium">Счёт</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.date}>
                <tr className="bg-slate-50/70 dark:bg-white/[0.03]">
                  <td colSpan={8} className="px-5 py-2 text-xs font-semibold text-slate-500 dark:text-neutral-400">
                    {g.date === today ? "Сегодня" : formatDate(g.date)}
                  </td>
                </tr>
                {g.items.map((it) => (
                  <EditableTransactionRow
                    key={it.tx.id}
                    tx={it.tx}
                    editable={it.editable}
                    teamId={teamId}
                    userId={userId}
                    attachments={it.attachments}
                    accounts={accounts}
                    categories={categories}
                    counterparties={counterparties}
                    projects={projects}
                    selected={sel.has(it.tx.id)}
                    onToggle={it.editable ? () => toggle(it.tx.id) : undefined}
                    displayBase={displayBase}
                    rates={rates}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">{label}</label>
      {children}
    </div>
  );
}
