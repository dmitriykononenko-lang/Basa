"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import DrilldownModal, { type DrillFilter } from "@/components/DrilldownModal";

type Cat = { id: string | null; name: string; value: number };

export default function PnlTable({
  base, revenue, revenueCats, direct, directCats, indirect, indirectCats,
  other, otherCats, gross, operating, net, teamId, userId, canEdit, dateFrom, dateTo,
}: {
  base: string;
  revenue: number; revenueCats: Cat[];
  direct: number; directCats: Cat[];
  indirect: number; indirectCats: Cat[];
  other: number; otherCats: Cat[];
  gross: number; operating: number; net: number;
  teamId: string; userId: string; canEdit: boolean;
  dateFrom: string; dateTo: string;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ rev: true, dir: true, ind: true, oth: true });
  const [drill, setDrill] = useState<{ title: string; filter: DrillFilter } | null>(null);
  const t = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  function openCat(cat: Cat, type: "income" | "expense") {
    if (!cat.id) return;
    setDrill({ title: cat.name, filter: { categoryId: cat.id, type, dateFrom, dateTo, status: "actual" } });
  }

  return (
    <>
      <div className="mt-6 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <table className="w-full text-sm">
          <tbody>
            <Section label="Выручка" value={formatMoney(revenue, base)} accent="emerald" bold open={open.rev} onClick={() => t("rev")} has={revenueCats.length > 0} />
            {open.rev && revenueCats.map((c) => <Item key={"r" + (c.id ?? c.name)} cat={c} value={"+" + formatMoney(c.value, base)} onClick={() => openCat(c, "income")} />)}

            <Section label="Прямые расходы" value={"−" + formatMoney(direct, base)} accent="red" open={open.dir} onClick={() => t("dir")} has={directCats.length > 0} />
            {open.dir && directCats.map((c) => <Item key={"d" + (c.id ?? c.name)} cat={c} value={"−" + formatMoney(c.value, base)} onClick={() => openCat(c, "expense")} />)}
            <Section label="Валовая прибыль" value={formatMoney(gross, base)} bold subtotal />

            <Section label="Косвенные расходы" value={"−" + formatMoney(indirect, base)} accent="red" open={open.ind} onClick={() => t("ind")} has={indirectCats.length > 0} />
            {open.ind && indirectCats.map((c) => <Item key={"i" + (c.id ?? c.name)} cat={c} value={"−" + formatMoney(c.value, base)} onClick={() => openCat(c, "expense")} />)}
            <Section label="Операционная прибыль" value={formatMoney(operating, base)} bold subtotal />

            {other > 0 && (
              <>
                <Section label="Прочие расходы" value={"−" + formatMoney(other, base)} accent="red" open={open.oth} onClick={() => t("oth")} has={otherCats.length > 0} />
                {open.oth && otherCats.map((c) => <Item key={"o" + (c.id ?? c.name)} cat={c} value={"−" + formatMoney(c.value, base)} onClick={() => openCat(c, "expense")} />)}
              </>
            )}

            <tr className="border-t-2 border-slate-200 dark:border-white/10">
              <td className="px-5 py-4 text-base font-bold text-slate-900 dark:text-white">Чистая прибыль</td>
              <td className={`px-5 py-4 text-right text-base font-bold ${net < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                {formatMoney(net, base)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {drill && (
        <DrilldownModal open onClose={() => setDrill(null)} title={drill.title} filter={drill.filter}
          teamId={teamId} userId={userId} canEdit={canEdit} />
      )}
    </>
  );
}

function Section({ label, value, bold, subtotal, accent, open, onClick, has }: {
  label: string; value: string; bold?: boolean; subtotal?: boolean;
  accent?: "emerald" | "red"; open?: boolean; onClick?: () => void; has?: boolean;
}) {
  const color = accent === "emerald" ? "text-emerald-600 dark:text-emerald-400" : accent === "red" ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white";
  return (
    <tr className={`border-b border-slate-100 dark:border-white/[0.06] ${subtotal ? "bg-slate-50/60 dark:bg-white/[0.02]" : ""}`}>
      <td className={`px-5 py-2.5 ${bold ? "font-semibold text-slate-900 dark:text-white" : "font-medium text-slate-600 dark:text-neutral-300"}`}>
        {has && onClick ? (
          <button onClick={onClick} className="inline-flex items-center gap-1.5 hover:text-brand">
            <span className="text-xs text-slate-400">{open ? "▾" : "▸"}</span>{label}
          </button>
        ) : label}
      </td>
      <td className={`px-5 py-2.5 text-right font-semibold ${color}`}>{value}</td>
    </tr>
  );
}

function Item({ cat, value, onClick }: { cat: Cat; value: string; onClick: () => void }) {
  const clickable = !!cat.id;
  return (
    <tr className="border-b border-slate-50 dark:border-white/[0.04]">
      <td
        className={`px-5 py-2 pl-10 text-slate-500 dark:text-neutral-400 ${clickable ? "cursor-pointer hover:text-brand hover:underline" : ""}`}
        onClick={clickable ? onClick : undefined}
      >
        {cat.name}
      </td>
      <td className="px-5 py-2 text-right text-slate-500 dark:text-neutral-400">{value}</td>
    </tr>
  );
}
