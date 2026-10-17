"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import DrilldownModal, { type DrillFilter } from "@/components/DrilldownModal";

type Cat = { id: string | null; name: string; values: number[] };

const GROUP_HEADER: Record<string, string> = {
  article: "Статья",
  activity: "Вид деятельности",
  account: "Счёт",
  counterparty: "Контрагент",
  project: "Проект",
};

export default function CashflowTable({
  monthLabels, monthKeys, base, opening, incomeM, incomeCats, expenseM, expenseCats, transferM, saldoM, closing,
  teamId, userId, canEdit, group = "article",
}: {
  monthLabels: string[];
  monthKeys: string[];
  base: string;
  opening: number[];
  incomeM: number[];
  incomeCats: Cat[];
  expenseM: number[];
  expenseCats: Cat[];
  transferM: number[];
  saldoM: number[];
  closing: number[];
  teamId: string;
  userId: string;
  canEdit: boolean;
  group?: string;
}) {
  const [incOpen, setIncOpen] = useState(true);
  const [expOpen, setExpOpen] = useState(true);
  const [drill, setDrill] = useState<{ title: string; filter: DrillFilter } | null>(null);
  const cell = "whitespace-nowrap px-4 py-2.5 text-right tabular-nums";

  function monthRange(mi: number) {
    const ym = monthKeys[mi];
    const [y, m] = ym.split("-").map(Number);
    const from = `${ym}-01`;
    const to = new Date(y, m, 0).toISOString().slice(0, 10);
    return { from, to };
  }
  function openCat(cat: Cat, type: "income" | "expense", mi: number) {
    if (group === "activity") return; // нет прямого фильтра операций по виду деятельности
    const { from, to } = monthRange(mi);
    const b = { dateFrom: from, dateTo: to, type, status: "actual" as const };
    let filter: DrillFilter;
    if (group === "account") filter = cat.id ? { ...b, accountId: cat.id } : b;
    else if (group === "counterparty") filter = cat.id ? { ...b, counterpartyId: cat.id } : { ...b, noCounterparty: true };
    else if (group === "project") filter = cat.id ? { ...b, projectId: cat.id } : { ...b, noProject: true };
    else filter = cat.id ? { ...b, categoryId: cat.id } : { ...b, uncategorized: true };
    setDrill({ title: `${cat.name} · ${monthLabels[mi]}`, filter });
  }
  const catClickable = group !== "activity";
  function openTransfers(mi: number) {
    const { from, to } = monthRange(mi);
    setDrill({
      title: `Переводы между счетами · ${monthLabels[mi]}`,
      filter: { type: "transfer", dateFrom: from, dateTo: to, status: "actual" },
    });
  }

  return (
    <>
      <div className="overflow-x-auto rounded-3xl bg-white ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
              <th className="sticky left-0 bg-white px-5 py-3 text-left font-medium dark:bg-[#15171c]">{GROUP_HEADER[group] ?? "Статья"}</th>
              {monthLabels.map((m, i) => <th key={i} className="px-4 py-3 text-right font-medium">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            <Row label="Деньги на начало периода" values={opening} muted cell={cell} base={base} />
            <Row label="Поступления" values={incomeM} bold accent="emerald" cell={cell} base={base}
              toggle={{ open: incOpen, onClick: () => setIncOpen((o) => !o), has: incomeCats.length > 0 }} />
            {incOpen && incomeCats.map((c) => (
              <CatRow key={"i" + (c.id ?? c.name)} cat={c} cell={cell} base={base}
                onCell={catClickable ? (mi) => openCat(c, "income", mi) : undefined} />
            ))}
            <Row label="Выплаты" values={expenseM.map((x) => -x)} bold accent="red" cell={cell} base={base}
              toggle={{ open: expOpen, onClick: () => setExpOpen((o) => !o), has: expenseCats.length > 0 }} />
            {expOpen && expenseCats.map((c) => (
              <CatRow key={"e" + (c.id ?? c.name)} cat={c} cell={cell} base={base} negate
                onCell={catClickable ? (mi) => openCat(c, "expense", mi) : undefined} />
            ))}
            <Row label="Сальдо" values={saldoM} bold signed cell={cell} base={base} />
            <Row label="Деньги на конец периода" values={closing} bold muted cell={cell} base={base} />
            <tr className="border-t-4 border-slate-100 dark:border-white/[0.06]">
              <td className="sticky left-0 bg-white px-5 py-2 text-xs text-slate-400 dark:bg-[#15171c] dark:text-neutral-500" colSpan={monthLabels.length + 1}>
                Справочно (не входит в сальдо):
              </td>
            </tr>
            <Row label="Переводы между счетами" values={transferM} muted cell={cell} base={base} onCell={openTransfers} />
          </tbody>
        </table>
      </div>

      {drill && (
        <DrilldownModal
          open onClose={() => setDrill(null)} title={drill.title} filter={drill.filter}
          teamId={teamId} userId={userId} canEdit={canEdit} base={base}
        />
      )}
    </>
  );
}

function CatRow({ cat, cell, base, negate, onCell }: {
  cat: Cat; cell: string; base: string; negate?: boolean; onCell?: (mi: number) => void;
}) {
  return (
    <tr className="border-b border-slate-50 last:border-0 dark:border-white/[0.04]">
      <td className="sticky left-0 bg-white px-5 py-2.5 pl-10 text-slate-500 dark:bg-[#15171c] dark:text-neutral-400">{cat.name}</td>
      {cat.values.map((v, i) => {
        const display = negate ? -v : v;
        const clickable = onCell && v !== 0;
        return (
          <td key={i} className={`${cell} text-slate-500 dark:text-neutral-400 ${clickable ? "cursor-pointer hover:text-brand hover:underline" : ""}`}
            onClick={clickable ? () => onCell!(i) : undefined}>
            {v === 0 ? "—" : formatMoney(display, base)}
          </td>
        );
      })}
    </tr>
  );
}

function Row({ label, values, bold, muted, accent, signed, cell, base, toggle, onCell }: {
  label: string; values: number[]; bold?: boolean; muted?: boolean;
  accent?: "emerald" | "red"; signed?: boolean; cell: string; base: string;
  toggle?: { open: boolean; onClick: () => void; has: boolean };
  onCell?: (mi: number) => void;
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
      <td className={`sticky left-0 bg-white px-5 py-2.5 dark:bg-[#15171c] font-medium ${labelColor} ${bold ? "font-semibold" : ""}`}>
        {toggle?.has ? (
          <button onClick={toggle.onClick} className="inline-flex items-center gap-1.5 hover:text-brand">
            <span className="text-xs text-slate-400">{toggle.open ? "▾" : "▸"}</span>{label}
          </button>
        ) : label}
      </td>
      {values.map((v, i) => {
        const clickable = onCell && v !== 0;
        return (
          <td key={i} className={`${cell} ${bold ? "font-semibold" : ""} ${color(v)} ${clickable ? "cursor-pointer hover:text-brand hover:underline" : ""}`}
            onClick={clickable ? () => onCell!(i) : undefined}>
            {v === 0 ? "—" : formatMoney(v, base)}
          </td>
        );
      })}
    </tr>
  );
}
