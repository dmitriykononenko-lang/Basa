"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney } from "@/lib/format";
import type { TxType } from "@/lib/types";

type Account = { id: string; name: string; currency: string };
type Named = { id: string; name: string };
type Category = { id: string; name: string; kind: "income" | "expense" };

export default function AddTransactionForm({
  teamId,
  userId,
  accounts,
  categories,
  counterparties,
  projects,
  employees = [],
}: {
  teamId: string;
  userId: string;
  accounts: Account[];
  categories: Category[];
  counterparties: Named[];
  projects: Named[];
  employees?: Named[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TxType>("expense");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [transferAccountId, setTransferAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [payPart, setPayPart] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = accounts.find((a) => a.id === accountId);
  const filteredCategories = useMemo(
    () => categories.filter((c) => c.kind === type),
    [categories, type]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const minor = parseMoney(amount);
    if (minor <= 0) {
      setError("Введите сумму больше нуля");
      return;
    }
    if (!account) {
      setError("Выберите счёт");
      return;
    }
    if (type === "transfer" && !transferAccountId) {
      setError("Выберите счёт назначения");
      return;
    }
    if (type === "transfer" && transferAccountId === accountId) {
      setError("Счета перевода должны отличаться");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("transactions").insert({
      team_id: teamId,
      type,
      amount: minor,
      currency: account.currency,
      account_id: accountId,
      transfer_account_id: type === "transfer" ? transferAccountId : null,
      category_id: type === "transfer" ? null : categoryId || null,
      counterparty_id: counterpartyId || null,
      project_id: projectId || null,
      employee_id: type === "expense" ? employeeId || null : null,
      pay_part: type === "expense" && employeeId ? payPart || null : null,
      occurred_on: date,
      note: note || null,
      created_by: userId,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setAmount("");
    setNote("");
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        + Добавить операцию
      </button>
    );
  }

  const TYPES: [TxType, string][] = [
    ["income", "Доход"],
    ["expense", "Расход"],
    ["transfer", "Перевод"],
  ];

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800"
    >
      <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
        {TYPES.map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`rounded-full px-2 py-1.5 font-medium transition ${
              type === t
                ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white"
                : "text-slate-500 hover:text-slate-700 dark:text-neutral-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Сумма">
          <input
            type="text"
            inputMode="decimal"
            required
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            className="input"
          />
        </Field>

        <Field label={type === "transfer" ? "Со счёта" : "Счёт"}>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="input"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </Field>

        {type === "transfer" && (
          <Field label="На счёт">
            <select
              value={transferAccountId}
              onChange={(e) => setTransferAccountId(e.target.value)}
              className="input"
            >
              <option value="">— выберите —</option>
              {accounts
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
            </select>
          </Field>
        )}

        {type !== "transfer" && (
          <Field label="Категория">
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="input"
            >
              <option value="">— без категории —</option>
              {filteredCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {type !== "transfer" && (
          <Field label="Контрагент">
            <select
              value={counterpartyId}
              onChange={(e) => setCounterpartyId(e.target.value)}
              className="input"
            >
              <option value="">— не указан —</option>
              {counterparties.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Проект">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="input"
          >
            <option value="">— без проекта —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        {type === "expense" && employees.length > 0 && (
          <Field label="Сотрудник (выплата)">
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="input"
            >
              <option value="">— не выплата —</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {type === "expense" && employeeId && (
          <Field label="Часть выплаты">
            <select
              value={payPart}
              onChange={(e) => setPayPart(e.target.value)}
              className="input"
            >
              <option value="">— не указана —</option>
              <option value="fixed">Фиксированная</option>
              <option value="variable">Переменная</option>
            </select>
          </Field>
        )}

        <Field label="Дата">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
          />
        </Field>

        <Field label="Комментарий">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Необязательно"
            className="input"
          />
        </Field>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Сохраняем…" : "Сохранить"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-ghost"
        >
          Отмена
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
        {label}
      </label>
      {children}
    </div>
  );
}
