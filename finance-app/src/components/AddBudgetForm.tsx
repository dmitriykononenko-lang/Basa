"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney } from "@/lib/format";

type Category = { id: string; name: string };

const PERIODS: { value: string; label: string }[] = [
  { value: "month", label: "Месяц" },
  { value: "quarter", label: "Квартал" },
  { value: "year", label: "Год" },
];

export default function AddBudgetForm({
  teamId,
  baseCurrency,
  categories,
}: {
  teamId: string;
  baseCurrency: string;
  categories: Category[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState("month");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Введите сумму больше нуля");
    if (!categoryId) return setError("Выберите категорию");

    setLoading(true);
    const supabase = createClient();

    // период с начала текущего месяца/квартала/года
    const now = new Date();
    let start: Date;
    if (period === "year") start = new Date(now.getFullYear(), 0, 1);
    else if (period === "quarter")
      start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    else start = new Date(now.getFullYear(), now.getMonth(), 1);

    const { error } = await supabase.from("budgets").insert({
      team_id: teamId,
      category_id: categoryId,
      amount: minor,
      currency: baseCurrency,
      period,
      period_start: start.toISOString().slice(0, 10),
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setAmount("");
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        + Добавить бюджет
      </button>
    );
  }

  if (categories.length === 0) {
    return (
      <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        Сначала появятся категории расходов — они создаются вместе с командой.
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3 rounded-3xl bg-white p-4 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800"
    >
      <div className="min-w-[180px] flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
          Категория расхода
        </label>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="input"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
          Лимит
        </label>
        <input
          type="text"
          inputMode="decimal"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0,00"
          className="input w-36"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
          Период
        </label>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="input"
        >
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "…" : "Сохранить"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
          Отмена
        </button>
      </div>
      {error && (
        <p className="w-full rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
          {error}
        </p>
      )}
    </form>
  );
}
