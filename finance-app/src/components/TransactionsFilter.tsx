"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import Combobox, { type ComboOption } from "@/components/Combobox";
import { DateRangePicker } from "@/components/ui/date-range-picker";

type Opt = { id: string; name: string; inn?: string | null };

export default function TransactionsFilter({
  accounts,
  projects,
  counterparties,
  categories,
}: {
  accounts: Opt[];
  projects: Opt[];
  counterparties: Opt[];
  categories: Opt[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");

  function setParams(patch: Record<string, string>) {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value && value !== "all") params.set(key, value);
      else params.delete(key);
    }
    router.push(`/transactions?${params.toString()}`);
  }
  const setParam = (k: string, v: string) => setParams({ [k]: v });

  const cls =
    "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none focus:border-brand dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-300";

  const period = sp.get("period") ?? "month";
  const toOpts = (items: Opt[]): ComboOption[] =>
    items.map((x) => ({ value: x.id, label: x.name, search: `${x.name} ${x.inn ?? ""}` }));

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <select value={period} onChange={(e) => setParams({ period: e.target.value, from: "", to: "" })} className={cls}>
        <option value="month">Текущий месяц</option>
        <option value="last_month">Прошлый месяц</option>
        <option value="quarter">Квартал</option>
        <option value="year">Год</option>
        <option value="all">Всё время</option>
        <option value="custom">Произвольный период</option>
      </select>

      {period === "custom" && (
        <DateRangePicker
          from={sp.get("from") ?? undefined}
          to={sp.get("to") ?? undefined}
          onChange={(f, t) => setParams({ from: f, to: t })}
        />
      )}

      <select value={sp.get("type") ?? "all"} onChange={(e) => setParam("type", e.target.value)} className={cls}>
        <option value="all">Все типы</option>
        <option value="income">Приход</option>
        <option value="expense">Расход</option>
        <option value="transfer">Перевод</option>
      </select>

      <select value={sp.get("status") ?? "all"} onChange={(e) => setParam("status", e.target.value)} className={cls}>
        <option value="all">План и факт</option>
        <option value="actual">Только факт</option>
        <option value="planned">Только план</option>
      </select>

      <Combobox className="min-w-[150px]" value={sp.get("account") ?? ""} onChange={(v) => setParam("account", v)} options={toOpts(accounts)} placeholder="Все счета" emptyLabel="Все счета" />
      <Combobox className="min-w-[150px]" value={sp.get("project") ?? ""} onChange={(v) => setParam("project", v)} options={toOpts(projects)} placeholder="Все проекты" emptyLabel="Все проекты" />
      <Combobox className="min-w-[160px]" value={sp.get("counterparty") ?? ""} onChange={(v) => setParam("counterparty", v)} options={toOpts(counterparties)} placeholder="Все контрагенты" emptyLabel="Все контрагенты" />
      <Combobox className="min-w-[150px]" value={sp.get("category") ?? ""} onChange={(v) => setParam("category", v)} options={toOpts(categories)} placeholder="Все статьи" emptyLabel="Все статьи" />

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") setParam("q", q); }}
        onBlur={() => setParam("q", q)}
        placeholder="Поиск по описанию"
        className={cls + " min-w-[160px]"}
      />

      {[...sp.keys()].some((k) => ["type", "status", "account", "project", "counterparty", "category", "q", "from", "to"].includes(k) && sp.get(k)) && (
        <button onClick={() => router.push("/transactions")} className="rounded-full px-3 py-1.5 text-sm text-slate-400 hover:text-brand">
          Сбросить
        </button>
      )}
    </div>
  );
}
