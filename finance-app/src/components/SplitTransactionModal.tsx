"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney, formatMoney } from "@/lib/format";
import { toast } from "@/lib/toast";
import Modal from "@/components/Modal";
import Combobox, { type ComboOption } from "@/components/Combobox";
import type { TxData } from "@/components/EditableTransactionRow";

type Category = { id: string; name: string; kind: "income" | "expense" };
type Named = { id: string; name: string; inn?: string | null };
type Part = { key: number; amount: string; categoryId: string; counterpartyId: string; projectId: string; note: string };

export default function SplitTransactionModal({
  open, onClose, tx, categories, counterparties, projects, teamId, userId, hasAttachments,
}: {
  open: boolean;
  onClose: () => void;
  tx: TxData;
  categories: Category[];
  counterparties: Named[];
  projects: Named[];
  teamId: string;
  userId: string;
  hasAttachments: boolean;
}) {
  const router = useRouter();
  const major = (tx.amount / 100).toFixed(2).replace(".", ",");
  const [parts, setParts] = useState<Part[]>([
    { key: 1, amount: major, categoryId: tx.category_id ?? "", counterpartyId: tx.counterparty_id ?? "", projectId: tx.project_id ?? "", note: "" },
    { key: 2, amount: "", categoryId: "", counterpartyId: tx.counterparty_id ?? "", projectId: tx.project_id ?? "", note: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredCats = categories.filter((c) => c.kind === tx.type);
  const sum = parts.reduce((s, p) => s + parseMoney(p.amount), 0);
  const remaining = tx.amount - sum;

  function upd(key: number, patch: Partial<Part>) { setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p))); }
  function add() { setParts((ps) => [...ps, { key: Date.now(), amount: "", categoryId: "", counterpartyId: tx.counterparty_id ?? "", projectId: tx.project_id ?? "", note: "" }]); }
  function del(key: number) { setParts((ps) => (ps.length > 2 ? ps.filter((p) => p.key !== key) : ps)); }
  function fillRemaining(key: number) {
    const others = parts.filter((p) => p.key !== key).reduce((s, p) => s + parseMoney(p.amount), 0);
    const rem = tx.amount - others;
    if (rem > 0) upd(key, { amount: (rem / 100).toFixed(2).replace(".", ",") });
  }

  async function save() {
    setError(null);
    if (parts.some((p) => parseMoney(p.amount) <= 0)) return setError("У каждой части сумма должна быть больше нуля");
    if (remaining !== 0) return setError(`Сумма частей должна совпасть с исходной. Разница: ${formatMoney(remaining, tx.currency)}`);
    setBusy(true);
    const supabase = createClient();
    const inserts = parts.map((p) => ({
      team_id: teamId, type: tx.type, amount: parseMoney(p.amount), currency: tx.currency,
      account_id: tx.account_id, transfer_account_id: null,
      category_id: tx.type === "transfer" ? null : (p.categoryId || null),
      counterparty_id: p.counterpartyId || null,
      project_id: p.projectId || null,
      occurred_on: tx.occurred_on, accrual_date: tx.accrual_date,
      note: p.note || tx.note || null, status: tx.status, created_by: userId,
    }));
    const { data: created, error: insErr } = await supabase.from("transactions").insert(inserts).select("id");
    if (insErr) { setBusy(false); return setError(insErr.message); }
    const firstId = (created as { id: string }[])?.[0]?.id;
    // перенести вложения на первую часть, чтобы не потерять
    if (hasAttachments && firstId) {
      await supabase.from("attachments").update({ transaction_id: firstId }).eq("transaction_id", tx.id);
    }
    const { error: delErr } = await supabase.from("transactions").delete().eq("id", tx.id);
    if (delErr) { setBusy(false); return setError(delErr.message); }
    setBusy(false);
    toast.success(`Операция разбита на ${parts.length}`);
    onClose();
    router.refresh();
  }

  const cpOpts: ComboOption[] = counterparties.map((c) => ({ value: c.id, label: c.name, search: `${c.name} ${c.inn ?? ""}` }));

  return (
    <Modal open={open} onClose={onClose} title="Разбить операцию" wide>
      <p className="mb-3 text-sm text-slate-500 dark:text-neutral-400">
        Исходная сумма: <b className="text-slate-800 dark:text-neutral-100">{formatMoney(tx.amount, tx.currency)}</b>.
        Задайте части — их сумма должна совпасть. Исходная операция заменится на эти части.
      </p>

      <div className="space-y-2">
        {parts.map((p, i) => (
          <div key={p.key} className="grid grid-cols-1 gap-2 rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.03] sm:grid-cols-12 sm:items-end">
            <div className="sm:col-span-3">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Сумма {i + 1}</label>
              <div className="flex gap-1">
                <input value={p.amount} onChange={(e) => upd(p.key, { amount: e.target.value })} inputMode="decimal" placeholder="0,00" className="input py-1.5 text-sm" />
                <button type="button" onClick={() => fillRemaining(p.key)} title="Остаток" className="shrink-0 rounded-xl border border-slate-200 px-2 text-xs text-brand dark:border-white/10">=ост</button>
              </div>
            </div>
            {tx.type !== "transfer" && (
              <div className="sm:col-span-3">
                <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Статья</label>
                <Combobox value={p.categoryId} onChange={(v) => upd(p.key, { categoryId: v })} placeholder="—" emptyLabel="— без статьи —"
                  options={filteredCats.map((c): ComboOption => ({ value: c.id, label: c.name }))} />
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Проект</label>
              <Combobox value={p.projectId} onChange={(v) => upd(p.key, { projectId: v })} placeholder="—" emptyLabel="— без проекта —"
                options={projects.map((pr): ComboOption => ({ value: pr.id, label: pr.name }))} />
            </div>
            {tx.type !== "transfer" && (
              <div className="sm:col-span-3">
                <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Контрагент</label>
                <Combobox value={p.counterpartyId} onChange={(v) => upd(p.key, { counterpartyId: v })} placeholder="—" emptyLabel="— не указан —" options={cpOpts} />
              </div>
            )}
            <div className="sm:col-span-1 sm:pb-1.5 sm:text-right">
              <button type="button" onClick={() => del(p.key)} disabled={parts.length <= 2} className="text-sm text-slate-400 hover:text-red-500 disabled:opacity-30">✕</button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <button type="button" onClick={add} className="text-brand">+ Ещё часть</button>
        <span className={remaining === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
          Сумма частей: {formatMoney(sum, tx.currency)} {remaining !== 0 && `· остаток ${formatMoney(remaining, tx.currency)}`}
        </span>
      </div>

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost">Отмена</button>
        <button onClick={save} disabled={busy || remaining !== 0} className="btn-primary">{busy ? "Разбиваем…" : "Разбить"}</button>
      </div>
    </Modal>
  );
}
