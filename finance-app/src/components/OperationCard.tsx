"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney } from "@/lib/format";
import { toast } from "@/lib/toast";
import Modal from "@/components/Modal";
import Combobox, { type ComboOption } from "@/components/Combobox";
import Attachments, { type Attachment } from "@/components/Attachments";
import type { TxData } from "@/components/EditableTransactionRow";

type Account = { id: string; name: string; currency: string };
type Named = { id: string; name: string; inn?: string | null };
type Category = { id: string; name: string; kind: "income" | "expense" };

const TITLES: Record<string, string> = {
  income: "Операция дохода",
  expense: "Операция расхода",
  transfer: "Перевод между счетами",
};

export default function OperationCard({
  open,
  onClose,
  tx,
  teamId,
  userId,
  accounts,
  categories,
  counterparties,
  projects,
  attachments,
  canEdit,
}: {
  open: boolean;
  onClose: () => void;
  tx: TxData;
  teamId: string;
  userId: string;
  accounts: Account[];
  categories: Category[];
  counterparties: Named[];
  projects: Named[];
  attachments: Attachment[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const isTransfer = tx.type === "transfer";
  const filteredCats = categories.filter((c) => c.kind === tx.type);

  const [amount, setAmount] = useState(String((tx.amount / 100).toFixed(2)).replace(".", ","));
  const [accountId, setAccountId] = useState(tx.account_id ?? "");
  const [toAccountId, setToAccountId] = useState(tx.transfer_account_id ?? "");
  const [categoryId, setCategoryId] = useState(tx.category_id ?? "");
  const [counterpartyId, setCounterpartyId] = useState(tx.counterparty_id ?? "");
  const [projectId, setProjectId] = useState(tx.project_id ?? "");
  const [date, setDate] = useState(tx.occurred_on);
  const [accrualDate, setAccrualDate] = useState(tx.accrual_date ?? "");
  const [note, setNote] = useState(tx.note ?? "");
  const [planned, setPlanned] = useState(tx.status === "planned");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imported = !!tx.import_batch_id;
  const acc = accounts.find((a) => a.id === accountId);
  const cur = acc?.currency ?? tx.currency;

  const typePill =
    tx.type === "income"
      ? { label: "Доход", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" }
      : tx.type === "expense"
        ? { label: "Расход", cls: "bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-300" }
        : { label: "Перевод", cls: "bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300" };
  const amountColor =
    tx.type === "income"
      ? "text-emerald-600 dark:text-emerald-400"
      : tx.type === "expense"
        ? "text-red-600 dark:text-red-400"
        : "text-slate-900 dark:text-white";

  async function save() {
    setError(null);
    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Сумма должна быть больше нуля");
    const account = accounts.find((a) => a.id === accountId);

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("transactions")
      .update({
        amount: minor,
        currency: account?.currency ?? tx.currency,
        account_id: accountId || null,
        transfer_account_id: isTransfer ? toAccountId || null : null,
        category_id: isTransfer ? null : categoryId || null,
        counterparty_id: isTransfer ? null : counterpartyId || null,
        project_id: projectId || null,
        occurred_on: date,
        accrual_date: isTransfer ? null : accrualDate || null,
        note: note || null,
        status: planned ? "planned" : "actual",
      })
      .eq("id", tx.id);
    setBusy(false);
    if (error) return setError(error.message);
    toast.success("Изменения сохранены");
    onClose();
    router.refresh();
  }

  async function remove() {
    if (!confirm("Удалить операцию?")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("transactions").delete().eq("id", tx.id);
    setBusy(false);
    if (error) return setError(error.message);
    toast.success("Операция удалена");
    onClose();
    router.refresh();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={
        <span className="flex items-center gap-2.5">
          {TITLES[tx.type] ?? "Операция"}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${typePill.cls}`}>{typePill.label}</span>
        </span>
      }
    >
      {imported && (
        <div className="mb-4 rounded-2xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800 ring-1 ring-amber-200/70 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/40">
          Импортирована из банка. Изменение <b>суммы</b>, <b>даты</b> или <b>счёта</b> создаст расхождение с банком.
        </div>
      )}

      {/* Сумма — крупным блоком */}
      <div className="mb-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <label className="mb-1 block text-left text-xs font-medium text-slate-500 dark:text-neutral-400">Сумма</label>
        <div className="flex items-baseline gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={!canEdit}
            inputMode="decimal"
            autoFocus
            className={`w-full bg-transparent text-3xl font-bold outline-none placeholder:text-slate-300 disabled:opacity-70 ${amountColor}`}
            placeholder="0,00"
          />
          <span className="shrink-0 text-lg font-semibold text-slate-400">{cur}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={isTransfer ? "Счёт списания" : "Счёт"}>
          <Combobox value={accountId} onChange={setAccountId} placeholder="Счёт"
            options={accounts.map((a): ComboOption => ({ value: a.id, label: a.name }))} />
        </Field>

        {isTransfer ? (
          <Field label="Счёт зачисления">
            <Combobox value={toAccountId} onChange={setToAccountId} placeholder="Счёт"
              options={accounts.map((a): ComboOption => ({ value: a.id, label: a.name }))} />
          </Field>
        ) : (
          <Field label="Статья">
            <Combobox value={categoryId} onChange={setCategoryId} placeholder="—" emptyLabel="— без статьи —"
              options={filteredCats.map((c): ComboOption => ({ value: c.id, label: c.name }))} />
          </Field>
        )}

        <Field label="Дата">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!canEdit} className="input" />
        </Field>

        {!isTransfer && (
          <Field label="Проект или направление">
            <Combobox value={projectId} onChange={setProjectId} placeholder="—" emptyLabel="— без проекта —"
              options={projects.map((p): ComboOption => ({ value: p.id, label: p.name }))} />
          </Field>
        )}
        {!isTransfer && (
          <Field label="Контрагент">
            <Combobox value={counterpartyId} onChange={setCounterpartyId} placeholder="—" emptyLabel="— не указан —"
              options={counterparties.map((c): ComboOption => ({ value: c.id, label: c.name, search: `${c.name} ${c.inn ?? ""}` }))} />
          </Field>
        )}
        {isTransfer && (
          <Field label="Проект или направление">
            <Combobox value={projectId} onChange={setProjectId} placeholder="—" emptyLabel="— без проекта —"
              options={projects.map((p): ComboOption => ({ value: p.id, label: p.name }))} />
          </Field>
        )}
        {!isTransfer && (
          <Field label="Дата начисления (для ОПиУ)">
            <input type="date" value={accrualDate} onChange={(e) => setAccrualDate(e.target.value)} disabled={!canEdit} className="input" placeholder="как дата платежа" />
          </Field>
        )}

        <div className="sm:col-span-2">
          <Field label="Описание">
            <input value={note} onChange={(e) => setNote(e.target.value)} disabled={!canEdit} className="input" placeholder="Комментарий к операции" />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <div className="mb-1 text-left text-xs font-medium text-slate-500 dark:text-neutral-400">Чеки и вложения</div>
          <Attachments teamId={teamId} transactionId={tx.id} userId={userId} items={attachments} canEdit={canEdit} />
        </div>
      </div>

      {canEdit && (
        <label className="mt-4 flex w-fit items-center gap-2 text-sm text-slate-600 dark:text-neutral-300">
          <input type="checkbox" checked={planned} onChange={(e) => setPlanned(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" />
          Плановая операция (не учитывается в фактических балансах и ДДС)
        </label>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {canEdit && (
        <div className="mt-4 flex items-center gap-3 border-t border-slate-200/70 pt-4 dark:border-white/[0.07]">
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? "…" : "Сохранить"}
          </button>
          <button onClick={onClose} className="btn-ghost">Отмена</button>
          <button onClick={remove} disabled={busy}
            className="ml-auto rounded-full px-4 py-2 text-sm font-medium text-red-500 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40">
            Удалить
          </button>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-left">
      <label className="mb-1 block text-left text-xs font-medium text-slate-500 dark:text-neutral-400">{label}</label>
      {children}
    </div>
  );
}
