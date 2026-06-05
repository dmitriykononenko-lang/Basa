"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate, parseMoney } from "@/lib/format";
import Attachments, { type Attachment } from "@/components/Attachments";

type Account = { id: string; name: string; currency: string };
type Named = { id: string; name: string };
type Category = { id: string; name: string; kind: "income" | "expense" };

export type TxData = {
  id: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  occurred_on: string;
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
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String((tx.amount / 100).toFixed(2)).replace(".", ","));
  const [accountId, setAccountId] = useState(tx.account_id ?? "");
  const [categoryId, setCategoryId] = useState(tx.category_id ?? "");
  const [counterpartyId, setCounterpartyId] = useState(tx.counterparty_id ?? "");
  const [projectId, setProjectId] = useState(tx.project_id ?? "");
  const [date, setDate] = useState(tx.occurred_on);
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
        className={`border-b border-slate-50 last:border-0 dark:border-white/[0.05] ${editable ? "cursor-pointer hover:bg-slate-50/70 dark:hover:bg-white/[0.02]" : ""}`}
      >
        <td className="whitespace-nowrap px-5 py-3 text-slate-500 dark:text-neutral-400">
          <span className="inline-flex items-center gap-1">
            {tx.status === "planned" && <span title="Плановая" className="text-violet-500">🕒</span>}
            {formatDate(tx.occurred_on)}
          </span>
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
              <button
                onClick={remove}
                disabled={busy}
                className="rounded-full px-2 py-1 text-xs text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                Удалить
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-slate-50 bg-slate-50/60 last:border-0 dark:border-white/[0.05] dark:bg-neutral-800/30">
      <td colSpan={7} className="px-5 py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Сумма">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
          </Field>
          <Field label="Счёт">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          {!isTransfer && (
            <Field label="Категория">
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input">
                <option value="">—</option>
                {filteredCats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          )}
          {!isTransfer && (
            <Field label="Контрагент">
              <select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)} className="input">
                <option value="">—</option>
                {counterparties.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Проект">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input">
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Дата">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
          </Field>
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
