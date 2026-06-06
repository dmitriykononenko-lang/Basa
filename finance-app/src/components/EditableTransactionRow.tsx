"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate, parseMoney } from "@/lib/format";
import { toast } from "@/lib/toast";
import Attachments, { type Attachment } from "@/components/Attachments";
import Combobox, { type ComboOption } from "@/components/Combobox";
import SplitTransactionModal from "@/components/SplitTransactionModal";

type Account = { id: string; name: string; currency: string };
type Named = { id: string; name: string; inn?: string | null };
type Category = { id: string; name: string; kind: "income" | "expense" };

export type TxData = {
  id: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  occurred_on: string;
  accrual_date: string | null;
  note: string | null;
  status: string;
  account_id: string | null;
  transfer_account_id: string | null;
  category_id: string | null;
  counterparty_id: string | null;
  project_id: string | null;
  accountName: string | null;
  toAccountName: string | null;
  categoryName: string | null;
  counterpartyName: string | null;
  projectName: string | null;
};

export default function EditableTransactionRow({
  tx,
  editable,
  teamId,
  userId,
  attachments,
  accounts,
  categories,
  counterparties,
  projects,
  selected = false,
  onToggle,
}: {
  tx: TxData;
  editable: boolean;
  teamId: string;
  userId: string;
  attachments: Attachment[];
  accounts: Account[];
  categories: Category[];
  counterparties: Named[];
  projects: Named[];
  selected?: boolean;
  onToggle?: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String((tx.amount / 100).toFixed(2)).replace(".", ","));
  const [accountId, setAccountId] = useState(tx.account_id ?? "");
  const [categoryId, setCategoryId] = useState(tx.category_id ?? "");
  const [counterpartyId, setCounterpartyId] = useState(tx.counterparty_id ?? "");
  const [projectId, setProjectId] = useState(tx.project_id ?? "");
  const [date, setDate] = useState(tx.occurred_on);
  const [accrualDate, setAccrualDate] = useState(tx.accrual_date ?? "");
  const [note, setNote] = useState(tx.note ?? "");

  const isTransfer = tx.type === "transfer";
  const filteredCats = categories.filter((c) => c.kind === tx.type);

  async function save() {
    setError(null);
    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Сумма больше нуля");
    const account = accounts.find((a) => a.id === accountId);

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("transactions")
      .update({
        amount: minor,
        currency: account?.currency ?? tx.currency,
        account_id: accountId || null,
        category_id: isTransfer ? null : categoryId || null,
        counterparty_id: isTransfer ? null : counterpartyId || null,
        project_id: projectId || null,
        occurred_on: date,
        accrual_date: accrualDate || null,
        note: note || null,
      })
      .eq("id", tx.id);

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setEditing(false);
    setBusy(false);
    toast.success("Изменения сохранены");
    router.refresh();
  }

  async function confirmPlanned() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("transactions")
      .update({ status: "actual", occurred_on: new Date().toISOString().slice(0, 10) })
      .eq("id", tx.id);
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    toast.success("Операция проведена");
    router.refresh();
  }

  async function remove() {
    if (!confirm("Удалить операцию?")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("transactions").delete().eq("id", tx.id);
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    toast.success("Операция удалена");
    router.refresh();
  }

  const sign = tx.type === "income" ? "+" : tx.type === "expense" ? "−" : "";
  const amountColor =
    tx.type === "income"
      ? "text-emerald-600 dark:text-emerald-400"
      : tx.type === "expense"
        ? "text-red-600 dark:text-red-400"
        : "text-slate-600 dark:text-neutral-300";

  if (!editing) {
    return (
      <tr
        onClick={() => editable && setEditing(true)}
        className={`border-b border-slate-50 last:border-0 dark:border-white/[0.05] ${selected ? "bg-brand/5" : ""} ${editable ? "cursor-pointer hover:bg-slate-50/70 dark:hover:bg-white/[0.02]" : ""}`}
      >
        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
          {onToggle && (
            <input type="checkbox" checked={selected} onChange={onToggle} className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" />
          )}
        </td>
        <td className="whitespace-nowrap px-5 py-3 text-slate-500 dark:text-neutral-400">
          <span className="inline-flex items-center gap-1">
            {tx.status === "planned" && <span title="Плановая" className="text-violet-500">🕒</span>}
            {formatDate(tx.occurred_on)}
          </span>
          {tx.accrual_date && tx.accrual_date !== tx.occurred_on && (
            <div className="text-[11px] text-violet-500/80" title="Дата начисления (учитывается в ОПиУ)">
              начислено: {formatDate(tx.accrual_date)}
            </div>
          )}
        </td>
        <td className={`whitespace-nowrap px-5 py-3 font-semibold ${amountColor}`}>
          {sign}
          {formatMoney(tx.amount, tx.currency)}
        </td>
        <td className="px-5 py-3">
          <div className="font-medium text-slate-800 dark:text-neutral-200">
            {isTransfer ? "Перевод" : tx.categoryName ?? "Без статьи"}
          </div>
          {(tx.note || attachments.length > 0) && (
            <div className="text-xs text-slate-400 dark:text-neutral-500">
              {tx.note}
              {attachments.length > 0 && <span className="ml-1">📎 {attachments.length}</span>}
            </div>
          )}
        </td>
        <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{tx.projectName ?? "—"}</td>
        <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{tx.counterpartyName ?? "—"}</td>
        <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">
          {isTransfer ? `${tx.accountName} → ${tx.toAccountName}` : tx.accountName}
        </td>
        <td className="px-3 py-3 text-right">
          {editable && (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {tx.status === "planned" && (
                <button
                  onClick={confirmPlanned}
                  disabled={busy}
                  className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
                >
                  Провести
                </button>
              )}
              <button
                onClick={() => setEditing(true)}
                className="rounded-full px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                Изм.
              </button>
              {!isTransfer && (
                <button
                  onClick={() => setSplitting(true)}
                  className="rounded-full px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  title="Разбить на несколько операций"
                >
                  Разбить
                </button>
              )}
              <button
                onClick={remove}
                disabled={busy}
                className="rounded-full px-2 py-1 text-xs text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                Удалить
              </button>
            </div>
          )}
          {splitting && (
            <SplitTransactionModal
              open={splitting}
              onClose={() => setSplitting(false)}
              tx={tx}
              categories={categories}
              counterparties={counterparties}
              projects={projects}
              teamId={teamId}
              userId={userId}
              hasAttachments={attachments.length > 0}
            />
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-slate-50 bg-slate-50/60 last:border-0 dark:border-white/[0.05] dark:bg-neutral-800/30">
      <td colSpan={8} className="px-5 py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Сумма">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
          </Field>
          <Field label="Счёт">
            <Combobox value={accountId} onChange={setAccountId} placeholder="Счёт"
              options={accounts.map((a): ComboOption => ({ value: a.id, label: a.name }))} />
          </Field>
          {!isTransfer && (
            <Field label="Статья">
              <Combobox value={categoryId} onChange={setCategoryId} placeholder="—" emptyLabel="— без статьи —"
                options={filteredCats.map((c): ComboOption => ({ value: c.id, label: c.name }))} />
            </Field>
          )}
          {!isTransfer && (
            <Field label="Контрагент">
              <Combobox value={counterpartyId} onChange={setCounterpartyId} placeholder="—" emptyLabel="— не указан —"
                options={counterparties.map((c): ComboOption => ({ value: c.id, label: c.name, search: `${c.name} ${c.inn ?? ""}` }))} />
            </Field>
          )}
          <Field label="Проект">
            <Combobox value={projectId} onChange={setProjectId} placeholder="—" emptyLabel="— без проекта —"
              options={projects.map((p): ComboOption => ({ value: p.id, label: p.name }))} />
          </Field>
          <Field label="Дата (платёж)">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
          </Field>
          {!isTransfer && (
            <Field label="Дата начисления">
              <input type="date" value={accrualDate} onChange={(e) => setAccrualDate(e.target.value)} className="input" placeholder="как дата платежа" />
            </Field>
          )}
          <div className="col-span-2 sm:col-span-3 lg:col-span-6">
            <Field label="Комментарий">
              <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
            </Field>
          </div>
          <div className="col-span-2 sm:col-span-3 lg:col-span-6">
            <Attachments
              teamId={teamId}
              transactionId={tx.id}
              userId={userId}
              items={attachments}
              canEdit={editable}
            />
          </div>
        </div>
        {!isTransfer && (
          <p className="mt-2 text-[11px] text-slate-400 dark:text-neutral-500">
            «Дата платежа» — для ДДС и баланса счёта (кассовый метод). «Дата начисления» — для ОПиУ
            (метод начисления): к какому периоду экономически относится доход/расход. Пусто = как дата платежа.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? "…" : "Сохранить"}
          </button>
          <button onClick={() => setEditing(false)} className="btn-ghost">
            Отмена
          </button>
        </div>
      </td>
    </tr>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
        {label}
      </label>
      {children}
    </div>
  );
}
