"use client";

import { useMemo, useState } from "react";
import { Select } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney } from "@/lib/format";
import { toast } from "@/lib/toast";
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
}: {
  teamId: string;
  userId: string;
  accounts: Account[];
  categories: Category[];
  counterparties: Named[];
  projects: Named[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TxType>("expense");
  const [planned, setPlanned] = useState(false);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [transferAccountId, setTransferAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [accrualDate, setAccrualDate] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // локальные списки (чтобы можно было создавать «на лету»)
  const [cps, setCps] = useState<Named[]>(counterparties);
  const [projs, setProjs] = useState<Named[]>(projects);
  // инлайн-добавление (без нативного prompt)
  const [cpAdd, setCpAdd] = useState(false);
  const [cpNew, setCpNew] = useState("");
  const [prAdd, setPrAdd] = useState(false);
  const [prNew, setPrNew] = useState("");

  async function saveCounterparty() {
    const name = cpNew.trim();
    if (!name) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("counterparties")
      .insert({ team_id: teamId, name, kind: "other", kinds: ["other"] })
      .select("id, name")
      .single();
    if (error) return toast.error(error.message);
    if (data) {
      setCps((p) => [...p, data].sort((a, b) => a.name.localeCompare(b.name)));
      setCounterpartyId(data.id);
      setCpAdd(false); setCpNew("");
      toast.success("Контрагент добавлен");
    }
  }

  async function saveProject() {
    const name = prNew.trim();
    if (!name) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("projects")
      .insert({ team_id: teamId, name })
      .select("id, name")
      .single();
    if (error) return toast.error(error.message);
    if (data) {
      setProjs((p) => [...p, data].sort((a, b) => a.name.localeCompare(b.name)));
      setProjectId(data.id);
      setPrAdd(false); setPrNew("");
      toast.success("Проект добавлен");
    }
  }

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
      occurred_on: date,
      accrual_date: type !== "transfer" ? accrualDate || null : null,
      note: note || null,
      status: planned ? "planned" : "actual",
      created_by: userId,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setAmount("");
    setNote("");
    setAccrualDate("");
    setOpen(false);
    setLoading(false);
    toast.success(planned ? "Плановая операция добавлена" : "Операция добавлена");
    router.refresh();
  }

  function openWith(t: TxType) {
    setType(t);
    setOpen(true);
  }

  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        <button onClick={() => openWith("income")} className="btn-primary" style={{ backgroundImage: "linear-gradient(180deg,#34c578,#22a565)", boxShadow: "0 4px 14px rgba(34,165,101,.3)" }}>
          + Приход
        </button>
        <button onClick={() => openWith("expense")} className="btn-primary" style={{ backgroundImage: "linear-gradient(180deg,#f2564e,#e23b32)", boxShadow: "0 4px 14px rgba(226,59,50,.3)" }}>
          − Расход
        </button>
        <button onClick={() => openWith("transfer")} className="btn-ghost ring-1 ring-slate-200 dark:ring-white/10">
          ⇄ Перевод
        </button>
      </div>
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
      className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]"
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

      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-300">
        <input
          type="checkbox"
          checked={planned}
          onChange={(e) => setPlanned(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
        />
        Плановая операция (прогноз — попадёт в платёжный календарь, не влияет на баланс)
      </label>

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
          <Select value={accountId} onChange={setAccountId} options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))} />
        </Field>

        {type === "transfer" && (
          <Field label="На счёт">
            <Select value={transferAccountId} onChange={setTransferAccountId} placeholder="— выберите —" options={[{ value: "", label: "— выберите —" }, ...accounts.filter((a) => a.id !== accountId).map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))]} />
          </Field>
        )}

        {type !== "transfer" && (
          <Field label="Категория">
            <Select value={categoryId} onChange={setCategoryId} placeholder="— без категории —" options={[{ value: "", label: "— без категории —" }, ...filteredCategories.map((c) => ({ value: c.id, label: c.name }))]} />
          </Field>
        )}

        {type !== "transfer" && (
          <Field label="Контрагент">
            {cpAdd ? (
              <div className="flex gap-1">
                <input autoFocus value={cpNew} onChange={(e) => setCpNew(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveCounterparty(); } if (e.key === "Escape") setCpAdd(false); }}
                  placeholder="Название контрагента" className="input" />
                <button type="button" onClick={saveCounterparty} className="shrink-0 rounded-xl bg-brand px-3 text-sm font-medium text-white">OK</button>
                <button type="button" onClick={() => setCpAdd(false)} className="shrink-0 rounded-xl px-2 text-sm text-slate-400">✕</button>
              </div>
            ) : (
              <div className="flex gap-1">
                <Select value={counterpartyId} onChange={setCounterpartyId} placeholder="— не указан —" options={[{ value: "", label: "— не указан —" }, ...cps.map((c) => ({ value: c.id, label: c.name }))]} />
                <button type="button" onClick={() => setCpAdd(true)} title="Новый контрагент" className="shrink-0 rounded-xl border border-slate-200 px-3 text-sm text-brand transition hover:bg-brand/5 dark:border-white/10">
                  +
                </button>
              </div>
            )}
          </Field>
        )}

        <Field label="Проект">
          {prAdd ? (
            <div className="flex gap-1">
              <input autoFocus value={prNew} onChange={(e) => setPrNew(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveProject(); } if (e.key === "Escape") setPrAdd(false); }}
                placeholder="Название проекта" className="input" />
              <button type="button" onClick={saveProject} className="shrink-0 rounded-xl bg-brand px-3 text-sm font-medium text-white">OK</button>
              <button type="button" onClick={() => setPrAdd(false)} className="shrink-0 rounded-xl px-2 text-sm text-slate-400">✕</button>
            </div>
          ) : (
            <div className="flex gap-1">
              <Select value={projectId} onChange={setProjectId} placeholder="— без проекта —" options={[{ value: "", label: "— без проекта —" }, ...projs.map((p) => ({ value: p.id, label: p.name }))]} />
              <button type="button" onClick={() => setPrAdd(true)} title="Новый проект" className="shrink-0 rounded-xl border border-slate-200 px-3 text-sm text-brand transition hover:bg-brand/5 dark:border-white/10">
                +
              </button>
            </div>
          )}
        </Field>

        <Field label={type === "transfer" ? "Дата" : "Дата (платёж)"}>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              const d = e.target.value;
              setDate(d);
              // дата ≠ сегодня → операция плановая
              setPlanned(d !== new Date().toISOString().slice(0, 10));
            }}
            className="input"
          />
        </Field>

        {type !== "transfer" && (
          <Field label="Дата начисления">
            <input
              type="date"
              value={accrualDate}
              onChange={(e) => setAccrualDate(e.target.value)}
              className="input"
            />
            <span className="mt-1 block text-[11px] text-slate-400 dark:text-neutral-500">
              Для ОПиУ (метод начисления). Пусто = как дата платежа.
            </span>
          </Field>
        )}

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
