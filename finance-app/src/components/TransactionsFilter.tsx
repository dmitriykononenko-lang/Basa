"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import Combobox, { type ComboOption } from "@/components/Combobox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Select } from "@/components/ui/select";

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
    // Смена любого фильтра всегда возвращает на первую страницу,
    // иначе остаётся ст'old page (напр. «Страница 2 из 1» → пусто).
    params.delete("page");
    router.push(`/transactions?${params.toString()}`);
  }
  const setParam = (k: string, v: string) => setParams({ [k]: v });

  const period = sp.get("period") ?? "month";
  const toOpts = (items: Opt[]): ComboOption[] =>
    items.map((x) => ({ value: x.id, label: x.name, search: `${x.name} ${x.inn ?? ""}` }));

  return (
    <div className="mb-5 space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <Select
        variant="pill"
        value={period}
        onChange={(v) => setParams({ period: v, from: "", to: "" })}
        options={[
          { value: "month", label: "Текущий месяц" },
          { value: "last_month", label: "Прошлый месяц" },
          { value: "quarter", label: "Квартал" },
          { value: "year", label: "Год" },
          { value: "all", label: "Всё время" },
          { value: "custom", label: "Произвольный период" },
        ]}
      />

      {period === "custom" && (
        <DateRangePicker
          from={sp.get("from") ?? undefined}
          to={sp.get("to") ?? undefined}
          onChange={(f, t) => setParams({ from: f, to: t })}
        />
      )}

      <Select
        variant="pill"
        value={sp.get("type") ?? "all"}
        onChange={(v) => setParam("type", v)}
        options={[
          { value: "all", label: "Все типы" },
          { value: "income", label: "Приход" },
          { value: "expense", label: "Расход" },
          { value: "transfer", label: "Перевод" },
        ]}
      />

      <Select
        variant="pill"
        value={sp.get("status") ?? "all"}
        onChange={(v) => setParam("status", v)}
        options={[
          { value: "all", label: "План и факт" },
          { value: "actual", label: "Только факт" },
          { value: "planned", label: "Только план" },
        ]}
      />

      <Combobox className="min-w-[150px]" value={sp.get("account") ?? ""} onChange={(v) => setParam("account", v)} options={toOpts(accounts)} placeholder="Все счета" emptyLabel="Все счета" />
      <Combobox className="min-w-[150px]" value={sp.get("project") ?? ""} onChange={(v) => setParam("project", v)} options={toOpts(projects)} placeholder="Все проекты" emptyLabel="Все проекты" />
      <Combobox className="min-w-[160px]" value={sp.get("counterparty") ?? ""} onChange={(v) => setParam("counterparty", v)} options={toOpts(counterparties)} placeholder="Все контрагенты" emptyLabel="Все контрагенты" />
      <Combobox className="min-w-[150px]" value={sp.get("category") ?? ""} onChange={(v) => setParam("category", v)} options={toOpts(categories)} placeholder="Все статьи" emptyLabel="Все статьи" />

      {[...sp.keys()].some((k) => ["type", "status", "account", "project", "counterparty", "category", "q", "from", "to"].includes(k) && sp.get(k)) && (
        <button onClick={() => router.push("/transactions")} className="rounded-full px-3 py-1.5 text-sm text-slate-400 hover:text-brand">
          Сбросить
        </button>
      )}
    </div>

    {/* Поиск по описанию — отдельной строкой на всю ширину (как в макете) */}
    <div className="relative">
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
      </svg>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") setParam("q", q); }}
        onBlur={() => setParam("q", q)}
        placeholder="Поиск по описанию"
        className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-brand dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-200 dark:placeholder:text-neutral-500"
      />
    </div>
    </div>
  );
}
