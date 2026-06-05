"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

type Opt = { id: string; name: string };

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

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value && value !== "all") params.set(key, value);
    else params.delete(key);
    router.push(`/transactions?${params.toString()}`);
  }

  const cls =
    "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none focus:border-brand dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-300";

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <select value={sp.get("period") ?? "month"} onChange={(e) => setParam("period", e.target.value)} className={cls}>
        <option value="month">Текущий месяц</option>
        <option value="quarter">Квартал</option>
        <option value="year">Год</option>
        <option value="all">Всё время</option>
      </select>

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

      <select value={sp.get("account") ?? "all"} onChange={(e) => setParam("account", e.target.value)} className={cls}>
        <option value="all">Все счета</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>

      <select value={sp.get("project") ?? "all"} onChange={(e) => setParam("project", e.target.value)} className={cls}>
        <option value="all">Все проекты</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      <select value={sp.get("counterparty") ?? "all"} onChange={(e) => setParam("counterparty", e.target.value)} className={cls}>
        <option value="all">Все контрагенты</option>
        {counterparties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <select value={sp.get("category") ?? "all"} onChange={(e) => setParam("category", e.target.value)} className={cls}>
        <option value="all">Все статьи</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") setParam("q", q); }}
        onBlur={() => setParam("q", q)}
        placeholder="Поиск по описанию"
        className={cls + " min-w-[180px]"}
      />

      {[...sp.keys()].some((k) => ["type", "status", "account", "project", "counterparty", "category", "q"].includes(k) && sp.get(k)) && (
        <button onClick={() => router.push("/transactions")} className="rounded-full px-3 py-1.5 text-sm text-slate-400 hover:text-brand">
          Сбросить
        </button>
      )}
    </div>
  );
}
