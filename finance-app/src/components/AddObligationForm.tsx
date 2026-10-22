"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney } from "@/lib/format";
import { CURRENCIES } from "@/lib/constants";

type Named = { id: string; name: string };
type Category = { id: string; name: string; kind: "income" | "expense" };

export default function AddObligationForm({
  teamId,
  userId,
  baseCurrency,
  counterparties,
  projects,
  categories = [],
}: {
  teamId: string;
  userId: string;
  baseCurrency: string;
  counterparties: Named[];
  projects: Named[];
  categories?: Category[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"receivable" | "payable">("receivable");
  const [counterpartyId, setCounterpartyId] = useState(counterparties[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(baseCurrency);
  const [categoryId, setCategoryId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const catKind = type === "receivable" ? "income" : "expense";
  const filteredCats = categories.filter((c) => c.kind === catKind);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Введите сумму больше нуля");
    if (!counterpartyId) return setError("Выберите контрагента");

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("obligations").insert({
      team_id: teamId,
      counterparty_id: counterpartyId,
      type,
      amount: minor,
      currency,
      category_id: categoryId || null,
      project_id: projectId || null,
      due_date: dueDate || null,
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
    setDueDate("");
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        + Добавить долг
      </button>
    );
  }

  if (counterparties.length === 0) {
    return (
      <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        Сначала добавьте хотя бы одного контрагента в разделе «Контрагенты».
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]"
    >
      <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
        {(
          [
            ["receivable", "Нам должны (дебиторка)"],
            ["payable", "Мы должны (кредиторка)"],
          ] as ["receivable" | "payable", string][]
        ).map(([t, label]) => (
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
        <Field label="Контрагент">
          <Select value={counterpartyId} onChange={setCounterpartyId} options={counterparties.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>

        <Field label="Сумма">
          <div className="flex gap-2">
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
            <Select className="w-24" value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </div>
        </Field>

        {filteredCats.length > 0 && (
          <Field label="Статья (для ОПиУ)">
            <Select value={categoryId} onChange={setCategoryId} placeholder="— без статьи —" options={[{ value: "", label: "— без статьи —" }, ...filteredCats.map((c) => ({ value: c.id, label: c.name }))]} />
          </Field>
        )}

        <Field label="Проект">
          <Select value={projectId} onChange={setProjectId} placeholder="— без проекта —" options={[{ value: "", label: "— без проекта —" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
        </Field>

        <Field label="Срок">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="input"
          />
        </Field>

        <div className="sm:col-span-2">
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
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Сохраняем…" : "Сохранить"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
          Отмена
        </button>
      </div>
    </form>
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
