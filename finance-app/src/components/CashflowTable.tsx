"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";

type Cats = [string, number[]][];

export default function CashflowTable({
  monthLabels,
  base,
  opening,
  incomeM,
  incomeCats,
  expenseM,
  expenseCats,
  saldoM,
  closing,
}: {
  monthLabels: string[];
  base: string;
  opening: number[];
  incomeM: number[];
  incomeCats: Cats;
  expenseM: number[];
  expenseCats: Cats;
  saldoM: number[];
  closing: number[];
}) {
  const [incOpen, setIncOpen] = useState(true);
  const [expOpen, setExpOpen] = useState(true);
  const cell = "whitespace-nowrap px-4 py-2.5 text-right tabular-nums";

  return (
    <div className="overflow-x-auto rounded-3xl bg-white ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
            <th className="sticky left-0 bg-white px-5 py-3 text-left font-medium dark:bg-[#15171c]">Статья</th>
            {monthLabels.map((m, i) => (
              <th key={i} className="px-4 py-3 text-right font-medium">{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label="Деньги на начало периода" values={opening} muted cell={cell} base={base} />
          <Row label="Поступления" values={incomeM} bold accent="emerald" cell={cell} base={base}
            toggle={{ open: incOpen, onClick: () => setIncOpen((o) => !o), has: incomeCats.length > 0 }} />
          {incOpen && incomeCats.map(([name, arr]) => (
            <Row key={"i" + name} label={name} values={arr} sub cell={cell} base={base} />
          ))}
          <Row label="Выплаты" values={expenseM.map((x) => -x)} bold accent="red" cell={cell} base={base}
            toggle={{ open: expOpen, onClick: () => setExpOpen((o) => !o), has: expenseCats.length > 0 }} />
          {expOpen && expenseCats.map(([name, arr]) => (
            <Row key={"e" + name} label={name} values={arr.map((x) => -x)} sub cell={cell} base={base} />
          ))}
          <Row label="Переводы между счетами" values={monthLabels.map(() => 0)} muted cell={cell} base={base} />
          <Row label="Сальдо" values={saldoM} bold signed cell={cell} base={base} />
          <Row label="Деньги на конец периода" values={closing} bold muted cell={cell} base={base} />
        </tbody>
      </table>
    </div>
  );
}

function Row({
  label, values, bold, sub, muted, accent, signed, cell, base, toggle,
}: {
  label: string;
  values: number[];
  bold?: boolean;
  sub?: boolean;
  muted?: boolean;
  accent?: "emerald" | "red";
  signed?: boolean;
  cell: string;
  base: string;
  toggle?: { open: boolean; onClick: () => void; has: boolean };
}) {
  const labelColor = muted ? "text-slate-400 dark:text-neutral-500" : "text-slate-800 dark:text-neutral-200";
  function color(v: number) {
    if (signed) return v < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400";
    if (accent === "emerald") return "text-emerald-600 dark:text-emerald-400";
    if (accent === "red") return "text-red-600 dark:text-red-400";
    if (muted) return "text-slate-400 dark:text-neutral-500";
    return "text-slate-600 dark:text-neutral-400";
  }
  return (
    <tr className="border-b border-slate-50 last:border-0 dark:border-white/[0.04]">
      <td className={`sticky left-0 bg-white px-5 py-2.5 dark:bg-[#15171c] ${sub ? "pl-10 text-slate-500 dark:text-neutral-400" : `font-medium ${labelColor}`} ${bold ? "font-semibold" : ""}`}>
        {toggle?.has ? (
          <button onClick={toggle.onClick} className="inline-flex items-center gap-1.5 hover:text-brand">
            <span className="text-xs text-slate-400">{toggle.open ? "▾" : "▸"}</span>
            {label}
          </button>
        ) : (
          label
        )}
      </td>
      {values.map((v, i) => (
        <td key={i} className={`${cell} ${bold ? "font-semibold" : ""} ${color(v)}`}>
          {v === 0 ? "—" : formatMoney(v, base)}
        </td>
      ))}
    </tr>
  );
}
