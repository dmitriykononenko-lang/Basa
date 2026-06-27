"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney } from "@/lib/format";
import { toast } from "@/lib/toast";
import Modal from "@/components/Modal";
import Combobox, { type ComboOption } from "@/components/Combobox";
import Attachments, { type Attachment } from "@/components/Attachments";
import OperationHistory from "@/components/OperationHistory";
import type { TxData } from "@/components/EditableTransactionRow";

type Account = { id: string; name: string; currency: string };
type Named = { id: string; name: string; inn?: string | null };
type Category = { id: string; name: string; kind: "income" | "expense" };

const TITLES: Record<string, string> = {
  income: "Операция дохода",
  expense: "Операция расхода",
  transfer: "Перевод между счетами",
};

const TYPE_STYLE = {
  income: {
    pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    label: "Доход",
    amount: "text-emerald-600 dark:text-emerald-400",
    tint: "bg-emerald-50/70 ring-emerald-200/70 dark:bg-emerald-500/[0.06] dark:ring-emerald-500/15",
    sign: "+",
  },
  expense: {
    pill: "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300",
    label: "Расход",
    amount: "text-red-600 dark:text-red-400",
    tint: "bg-red-50/70 ring-red-200/70 dark:bg-red-500/[0.06] dark:ring-red-500/15",
    sign: "−",
  },
  transfer: {
    pill: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
    label: "Перевод",
    amount: "text-slate-900 dark:text-white",
    tint: "bg-slate-100/70 ring-slate-200/80 dark:bg-white/[0.04] dark:ring-white/[0.08]",
    sign: "",
  },
} as const;

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
  const ts = TYPE_STYLE[tx.type];

  const [amount, setAmount] = useState(String((tx.amount / 100).toFixed(2)).replace(".", ","));
  const [accountId, setAccountId] = useState(tx.account_id ?? "");
  const [toAccountId, setToAccountId] = useState(tx.transfer_account_id ?? "");
  const [categoryId, setCategoryId] = useState(tx.category_id ?? "");
  const [counterpartyId, setCounterpartyId] = useState(tx.counterparty_id ?? "");
  const [projectId, setProjectId] = useState(tx.project_id ?? "");
  const [date, setDate] = useState(tx.occurred_on);
  const [accrualDate, setAccrualDate] = useState(tx.accrual_date ?? "");
  const [showAccrual, setShowAccrual] = useState(!!tx.accrual_date);
  const [note, setNote] = useState(tx.note ?? "");
  const [planned, setPlanned] = useState(tx.status === "planned");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imported = !!tx.import_batch_id;
  const acc = accounts.find((a) => a.id === accountId);
  const cur = acc?.currency ?? tx.currency;
  const accOptions = accounts.map((a): ComboOption => ({ value: a.id, label: a.name }));

  async function save() {
    setError(null);
    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Сумма должна быть больше нуля");
    if (!accountId) return setError(isTransfer ? "Укажите счёт списания" : "Укажите счёт");
    if (isTransfer && !toAccountId) return setError("Укажите счёт зачисления");
    if (isTransfer && toAccountId === accountId) return setError("Счета списания и зачисления совпадают");
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
        accrual_date: isTransfer || !showAccrual ? null : accrualDate || null,
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
      size="xl"
      title={
        <span className="flex items-center gap-2.5">
          {TITLES[tx.type] ?? "Операция"}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ts.pill}`}>{ts.label}</span>
        </span>
      }
    >
      {imported && (
        <div className="mb-4 flex items-start gap-2.5 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200/70 dark:bg-amber-500/[0.07] dark:text-amber-200/90 dark:ring-amber-500/20">
          <svg viewBox="0 0 24 24" className="mt-px h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          </svg>
          <span>Импортирована из банка. Изменение <b>суммы</b>, <b>даты</b> или <b>счёта</b> создаст расхождение с банком.</span>
        </div>
      )}

      {/* Сумма — крупным блоком, тон по типу операции */}
      <div className={`mb-5 rounded-2xl px-4 py-3.5 ring-1 ${ts.tint}`}>
        <label className="mb-0.5 block text-left text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-neutral-400">
          Сумма
        </label>
        <div className="flex items-baseline gap-2">
          {ts.sign && <span className={`text-3xl font-bold ${ts.amount}`}>{ts.sign}</span>}
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={!canEdit}
            inputMode="decimal"
            autoFocus
            className={`w-full bg-transparent text-3xl font-bold tabular-nums outline-none placeholder:text-slate-300 disabled:opacity-70 dark:placeholder:text-neutral-600 ${ts.amount}`}
            placeholder="0,00"
          />
          <span className="shrink-0 text-base font-semibold text-slate-400 dark:text-neutral-500">{cur}</span>
        </div>
      </div>

      {/* Перевод: счёт списания → счёт зачисления */}
      {isTransfer ? (
        <div className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <Field label="Счёт списания">
            <Combobox value={accountId} onChange={setAccountId} placeholder="Счёт" options={accOptions} />
          </Field>
          <div className="hidden pb-2.5 text-slate-400 dark:text-neutral-500 sm:block">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </div>
          <Field label="Счёт зачисления">
            <Combobox value={toAccountId} onChange={setToAccountId} placeholder="Счёт" options={accOptions} />
          </Field>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        {!isTransfer && (
          <Field label="Счёт">
            <Combobox value={accountId} onChange={setAccountId} placeholder="Счёт" options={accOptions} />
          </Field>
        )}

        {!isTransfer && (
          <Field label="Статья">
            <Combobox value={categoryId} onChange={setCategoryId} placeholder="—" emptyLabel="— без статьи —"
              options={filteredCats.map((c): ComboOption => ({ value: c.id, label: c.name }))} />
          </Field>
        )}

        <Field label="Дата">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!canEdit} className="input" />
        </Field>

        <Field label="Проект или направление">
          <Combobox value={projectId} onChange={setProjectId} placeholder="—" emptyLabel="— без проекта —"
            options={projects.map((p): ComboOption => ({ value: p.id, label: p.name }))} />
        </Field>

        {!isTransfer && (
          <Field label="Контрагент">
            <Combobox value={counterpartyId} onChange={setCounterpartyId} placeholder="—" emptyLabel="— не указан —"
              options={counterparties.map((c): ComboOption => ({ value: c.id, label: c.name, search: `${c.name} ${c.inn ?? ""}` }))} />
          </Field>
        )}

        <div className="sm:col-span-2">
          <Field label="Описание">
            <input value={note} onChange={(e) => setNote(e.target.value)} disabled={!canEdit} className="input" placeholder="Комментарий к операции" />
          </Field>
        </div>
      </div>

      {/* Дата начисления — необязательное, спрятано под переключателем */}
      {!isTransfer && (
        <div className="mt-4">
          {showAccrual ? (
            <Field
              label={
                <span className="flex items-center justify-between">
                  Дата начисления (для ОПиУ)
                  <button
                    type="button"
                    onClick={() => { setShowAccrual(false); setAccrualDate(""); }}
                    className="text-[11px] font-medium text-slate-400 hover:text-slate-600 dark:hover:text-neutral-300"
                  >
                    убрать
                  </button>
                </span>
              }
            >
              <input type="date" value={accrualDate} onChange={(e) => setAccrualDate(e.target.value)} disabled={!canEdit} className="input" />
            </Field>
          ) : (
            canEdit && (
              <button
                type="button"
                onClick={() => setShowAccrual(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-brand transition hover:opacity-80"
              >
                <span className="text-base leading-none">+</span> Начислить на другую дату (для ОПиУ)
              </button>
            )
          )}
        </div>
      )}

      {/* Чеки и вложения — заголовок рисует сам Attachments */}
      <div className="mt-5">
        <Attachments teamId={teamId} transactionId={tx.id} userId={userId} items={attachments} canEdit={canEdit} />
      </div>

      {/* История изменений — кто, когда и что менял */}
      <OperationHistory
        transactionId={tx.id}
        currency={cur}
        accounts={accounts}
        categories={categories}
        counterparties={counterparties}
        projects={projects}
      />

      {canEdit && (
        <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-xl bg-slate-100/70 px-3.5 py-3 ring-1 ring-slate-200/70 dark:bg-white/[0.03] dark:ring-white/[0.06]">
          <input type="checkbox" checked={planned} onChange={(e) => setPlanned(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-white/20" />
          <span className="text-sm text-slate-700 dark:text-neutral-200">
            Плановая операция
            <span className="block text-xs text-slate-400 dark:text-neutral-500">не учитывается в фактических балансах и ДДС</span>
          </span>
        </label>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {canEdit && (
        <div className="mt-5 flex items-center gap-2 border-t border-slate-200/70 pt-4 dark:border-white/[0.07]">
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? "…" : "Сохранить"}
          </button>
          <button onClick={onClose} className="btn-ghost">Отмена</button>
          <button onClick={remove} disabled={busy}
            className="ml-auto rounded-full px-4 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-500/10">
            Удалить
          </button>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="text-left">
      <label className="mb-1.5 block text-left text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-neutral-400">
        {label}
      </label>
      {children}
    </div>
  );
}
