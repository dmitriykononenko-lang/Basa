"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney, formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";
import Modal from "@/components/Modal";
import Combobox, { type ComboOption } from "@/components/Combobox";
import Attachments, { type Attachment } from "@/components/Attachments";
import OperationHistory from "@/components/OperationHistory";
import SplitTransactionModal from "@/components/SplitTransactionModal";
import TransactionPartsModal from "@/components/TransactionPartsModal";
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
  const [txType, setTxType] = useState<TxData["type"]>(tx.type);
  const isTransfer = txType === "transfer";
  const filteredCats = categories.filter((c) => c.kind === txType);
  const ts = TYPE_STYLE[txType];

  const [amount, setAmount] = useState(String((tx.amount / 100).toFixed(2)).replace(".", ","));
  const [toAmount, setToAmount] = useState(
    tx.transfer_amount ? (tx.transfer_amount / 100).toFixed(2).replace(".", ",") : "",
  );
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
  const [splitting, setSplitting] = useState(false);
  const [parting, setParting] = useState(false);

  const imported = !!tx.import_batch_id;
  const acc = accounts.find((a) => a.id === accountId);
  const cur = acc?.currency ?? tx.currency;
  const toAcc = accounts.find((a) => a.id === toAccountId);
  const toCur = toAcc?.currency ?? tx.transfer_currency ?? cur;
  // Кросс-валютный перевод — сумма зачисления в другой валюте, её нужно ввести отдельно.
  const crossCurrency = isTransfer && !!acc && !!toAcc && acc.currency !== toAcc.currency;
  const accOptions = accounts.map((a): ComboOption => ({ value: a.id, label: `${a.name} (${a.currency})` }));

  async function save() {
    setError(null);
    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Сумма должна быть больше нуля");
    if (!accountId) return setError(isTransfer ? "Укажите счёт списания" : "Укажите счёт");
    if (isTransfer && !toAccountId) return setError("Укажите счёт зачисления");
    if (isTransfer && toAccountId === accountId) return setError("Счета списания и зачисления совпадают");
    if (isTransfer && (tx.splitCount ?? 0) >= 2)
      return setError("Операция разбита на части — сначала уберите части, перевод нельзя делить.");
    const account = accounts.find((a) => a.id === accountId);

    // Приход: при разных валютах — введённая сумма зачисления; при одной валюте — равен списанию (null).
    let creditMinor: number | null = null;
    if (crossCurrency) {
      creditMinor = parseMoney(toAmount);
      if (creditMinor <= 0) return setError("Укажите сумму зачисления");
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("transactions")
      .update({
        type: txType,
        amount: minor,
        currency: account?.currency ?? tx.currency,
        account_id: accountId || null,
        transfer_account_id: isTransfer ? toAccountId || null : null,
        transfer_amount: isTransfer ? creditMinor : null,
        transfer_currency: isTransfer && creditMinor != null ? (toAcc?.currency ?? null) : null,
        category_id: isTransfer ? null : categoryId || null,
        counterparty_id: isTransfer ? null : counterpartyId || null,
        project_id: projectId || null,
        occurred_on: date,
        accrual_date: isTransfer || !showAccrual ? null : accrualDate || null,
        note: note || null,
        status: planned ? "planned" : "actual",
        // Перевод не может гасить обязательство — очищаем привязку при конвертации.
        ...(isTransfer ? { obligation_id: null } : {}),
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
    <>
    <Modal
      open={open}
      onClose={onClose}
      side="right"
      title={
        <div className="flex items-center gap-3">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base ring-1 ${ts.tint} ${ts.amount}`}>
            {txType === "income" ? "↗" : txType === "expense" ? "↘" : "⇄"}
          </span>
          <div className="min-w-0">
            <div className="truncate text-lg font-bold leading-tight text-slate-900 dark:text-white">{TITLES[txType] ?? "Операция"}</div>
            <div className="truncate text-xs font-normal text-slate-400 dark:text-neutral-500">
              {formatDate(date)}{acc?.name ? ` · ${acc.name}` : ""}
            </div>
          </div>
        </div>
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

      {/* Тип операции — можно переключить, в т.ч. конвертировать в перевод */}
      {canEdit && (
        <div className="mb-4 grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
          {(["income", "expense", "transfer"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTxType(t)}
              className={`rounded-full px-2 py-1.5 font-medium transition ${
                txType === t
                  ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-700 dark:text-neutral-400"
              }`}
            >
              {TYPE_STYLE[t].label}
            </button>
          ))}
        </div>
      )}
      {canEdit && txType !== tx.type && (
        <p className="mb-4 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700 ring-1 ring-blue-200/70 dark:bg-blue-500/[0.07] dark:text-blue-200/90 dark:ring-blue-500/20">
          {isTransfer
            ? "Операция станет переводом между счетами. Статья и контрагент очистятся; укажите счёт зачисления."
            : `Тип изменится на «${ts.label.toLowerCase()}».`}
        </p>
      )}

      {/* Сумма — крупным блоком, тон по типу операции */}
      <div className={`mb-5 rounded-2xl px-4 py-3.5 ring-1 ${ts.tint}`}>
        <label className="mb-0.5 block text-left text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-neutral-400">
          {isTransfer ? "Сумма списания" : "Сумма"}
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

      {/* Кросс-валютный перевод: сумма зачисления в валюте счёта назначения */}
      {isTransfer && crossCurrency && (
        <div className="mb-4 rounded-2xl bg-blue-50/60 px-4 py-3 ring-1 ring-blue-200/60 dark:bg-blue-500/[0.06] dark:ring-blue-500/15">
          <label className="mb-0.5 block text-left text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-neutral-400">
            Сумма зачисления
          </label>
          <div className="flex items-baseline gap-2">
            <input
              value={toAmount}
              onChange={(e) => setToAmount(e.target.value)}
              disabled={!canEdit}
              inputMode="decimal"
              className="w-full bg-transparent text-2xl font-bold tabular-nums text-slate-900 outline-none placeholder:text-slate-300 disabled:opacity-70 dark:text-white dark:placeholder:text-neutral-600"
              placeholder="0,00"
            />
            <span className="shrink-0 text-base font-semibold text-slate-400 dark:text-neutral-500">{toCur}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">
            Списываем {amount || "0,00"} {cur}, зачисляем в {toCur} по факту — курсы у счетов разные.
          </p>
        </div>
      )}

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
          {!isTransfer && (
            <button onClick={() => setParting(true)} disabled={busy}
              title="Разбить сумму на части по статьям/проектам — операция останется одной записью"
              className="rounded-full px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-white/[0.06]">
              Части операции
            </button>
          )}
          {!isTransfer && (
            <button onClick={() => setSplitting(true)} disabled={busy}
              title="Разделить на несколько отдельных операций (исходная заменится)"
              className="rounded-full px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-white/[0.06]">
              На операции
            </button>
          )}
          <button onClick={remove} disabled={busy}
            className="ml-auto rounded-full px-4 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-500/10">
            Удалить
          </button>
        </div>
      )}
    </Modal>
    {parting && (
      <TransactionPartsModal
        open={parting}
        onClose={() => setParting(false)}
        tx={tx}
        categories={categories}
        counterparties={counterparties}
        projects={projects}
        teamId={teamId}
      />
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
    </>
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
