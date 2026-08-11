"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney, formatMoney } from "@/lib/format";
import { toast } from "@/lib/toast";
import Modal from "@/components/Modal";
import Combobox, { type ComboOption } from "@/components/Combobox";
import type { TxData } from "@/components/EditableTransactionRow";

type Category = { id: string; name: string; kind: "income" | "expense" };
type Named = { id: string; name: string; inn?: string | null };
type Part = { key: number; amount: string; categoryId: string; projectId: string; counterpartyId: string; isObligation: boolean };

// Внутренняя разбивка операции на части (операция остаётся ОДНОЙ записью).
// Части хранятся в transaction_splits и используются в отчётах (view transaction_lines).
export default function TransactionPartsModal({
  open, onClose, tx, categories, counterparties, projects, teamId,
}: {
  open: boolean;
  onClose: () => void;
  tx: TxData;
  categories: Category[];
  counterparties: Named[];
  projects: Named[];
  teamId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const major = (tx.amount / 100).toFixed(2).replace(".", ",");
  const [parts, setParts] = useState<Part[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("transaction_splits")
        .select("amount, category_id, project_id, counterparty_id, is_obligation")
        .eq("transaction_id", tx.id)
        .order("created_at");
      if (!alive) return;
      const rows = (data ?? []) as { amount: number; category_id: string | null; project_id: string | null; counterparty_id: string | null; is_obligation: boolean }[];
      if (rows.length >= 2) {
        setParts(rows.map((r, i) => ({
          key: i + 1, amount: (r.amount / 100).toFixed(2).replace(".", ","),
          categoryId: r.category_id ?? "", projectId: r.project_id ?? "",
          counterpartyId: r.counterparty_id ?? "", isObligation: r.is_obligation,
        })));
      } else {
        setParts([
          { key: 1, amount: major, categoryId: tx.category_id ?? "", projectId: tx.project_id ?? "", counterpartyId: tx.counterparty_id ?? "", isObligation: false },
          { key: 2, amount: "", categoryId: "", projectId: "", counterpartyId: tx.counterparty_id ?? "", isObligation: false },
        ]);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.id]);

  const filteredCats = categories.filter((c) => c.kind === tx.type);
  const sum = parts.reduce((s, p) => s + parseMoney(p.amount), 0);
  const remaining = tx.amount - sum;
  const cpOpts: ComboOption[] = counterparties.map((c) => ({ value: c.id, label: c.name, search: `${c.name} ${c.inn ?? ""}` }));

  function upd(key: number, patch: Partial<Part>) { setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p))); }
  function add() { setParts((ps) => [...ps, { key: Date.now(), amount: "", categoryId: "", projectId: "", counterpartyId: tx.counterparty_id ?? "", isObligation: false }]); }
  function del(key: number) { setParts((ps) => (ps.length > 2 ? ps.filter((p) => p.key !== key) : ps)); }
  function fillRemaining(key: number) {
    const others = parts.filter((p) => p.key !== key).reduce((s, p) => s + parseMoney(p.amount), 0);
    const rem = tx.amount - others;
    if (rem > 0) upd(key, { amount: (rem / 100).toFixed(2).replace(".", ",") });
  }

  async function save() {
    setError(null);
    if (parts.some((p) => parseMoney(p.amount) <= 0)) return setError("У каждой части сумма должна быть больше нуля");
    if (remaining !== 0) return setError(`Сумма частей должна совпасть с общей. Разница: ${formatMoney(remaining, tx.currency)}`);
    setBusy(true);
    await supabase.from("transaction_splits").delete().eq("transaction_id", tx.id);
    const rows = parts.map((p) => ({
      team_id: teamId, transaction_id: tx.id, amount: parseMoney(p.amount),
      category_id: p.categoryId || null, project_id: p.projectId || null,
      counterparty_id: p.counterpartyId || null, is_obligation: p.isObligation,
    }));
    const { error: insErr } = await supabase.from("transaction_splits").insert(rows);
    setBusy(false);
    if (insErr) return setError(insErr.message);
    toast.success("Операция разбита на части");
    onClose();
    router.refresh();
  }

  async function clearSplit() {
    setBusy(true);
    const { error: e } = await supabase.from("transaction_splits").delete().eq("transaction_id", tx.id);
    setBusy(false);
    if (e) return setError(e.message);
    toast.success("Разбивка убрана");
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title="Части операции" wide>
      <p className="mb-3 text-sm text-slate-500 dark:text-neutral-400">
        Общая сумма: <b className="text-slate-800 dark:text-neutral-100">{formatMoney(tx.amount, tx.currency)}</b>.
        Операция останется одной записью; части распределяют её по статьям и проектам для отчётов.
      </p>

      {loading ? (
        <p className="py-6 text-sm text-slate-400">Загрузка…</p>
      ) : (
        <>
          <div className="space-y-2">
            {parts.map((p, i) => (
              <div key={p.key} className="grid grid-cols-1 gap-2 rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.03] sm:grid-cols-12 sm:items-end">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Сумма {i + 1}</label>
                  <div className="flex gap-1">
                    <input value={p.amount} onChange={(e) => upd(p.key, { amount: e.target.value })} inputMode="decimal" placeholder="0,00" className="input py-1.5 text-sm" />
                    <button type="button" onClick={() => fillRemaining(p.key)} title="Остаток" className="shrink-0 rounded-xl border border-slate-200 px-2 text-xs text-brand dark:border-white/10">=ост</button>
                  </div>
                </div>
                <div className="sm:col-span-3">
                  <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Статья</label>
                  <Combobox value={p.categoryId} onChange={(v) => upd(p.key, { categoryId: v })} placeholder="—" emptyLabel="— без статьи —"
                    options={filteredCats.map((c): ComboOption => ({ value: c.id, label: c.name }))} />
                </div>
                <div className="sm:col-span-3">
                  <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Проект / направление</label>
                  <Combobox value={p.projectId} onChange={(v) => upd(p.key, { projectId: v })} placeholder="—" emptyLabel="— без проекта —"
                    options={projects.map((pr): ComboOption => ({ value: pr.id, label: pr.name }))} />
                </div>
                <div className="sm:col-span-3">
                  <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Контрагент</label>
                  <Combobox value={p.counterpartyId} onChange={(v) => upd(p.key, { counterpartyId: v })} placeholder="—" emptyLabel="— не указан —" options={cpOpts} />
                </div>
                <div className="flex items-center justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end sm:pb-1.5">
                  <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-neutral-400" title="Пометить часть как обязательство">
                    <input type="checkbox" checked={p.isObligation} onChange={(e) => upd(p.key, { isObligation: e.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand" />
                    об-во
                  </label>
                  <button type="button" onClick={() => del(p.key)} disabled={parts.length <= 2} className="text-sm text-slate-400 hover:text-red-500 disabled:opacity-30">✕</button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between text-sm">
            <button type="button" onClick={add} className="text-brand">+ Разбить ещё</button>
            <span className={remaining === 0 ? "inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
              {remaining === 0 ? "✓ Вся сумма распределена" : `Распределено ${formatMoney(sum, tx.currency)} · остаток ${formatMoney(remaining, tx.currency)}`}
            </span>
          </div>

          {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button onClick={clearSplit} disabled={busy} className="mr-auto text-sm text-slate-400 hover:text-red-500 disabled:opacity-50">Убрать разбивку</button>
            <button onClick={onClose} className="btn-ghost">Отмена</button>
            <button onClick={save} disabled={busy || remaining !== 0} className="btn-primary">{busy ? "Сохраняем…" : "Сохранить части"}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
