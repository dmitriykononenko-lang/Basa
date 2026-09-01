"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import DrilldownModal from "@/components/DrilldownModal";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export type DayInfo = { opening: number; in: number; out: number; net: number; closing: number };
export type Cell = { dn: number | null; dateStr: string | null; info: DayInfo | null };

export default function CalendarGrid({
  cells, base, todayStr, teamId, userId, canEdit,
}: {
  cells: Cell[];
  base: string;
  todayStr: string;
  teamId: string;
  userId: string;
  canEdit: boolean;
}) {
  const [day, setDay] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        <div className="grid grid-cols-7 gap-px">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl bg-slate-200/70 ring-1 ring-slate-200/70 dark:bg-white/[0.04] dark:ring-white/[0.07]">
          {cells.map((c, i) => {
            if (c.dn === null) return <div key={i} className="min-h-[120px] bg-slate-50 dark:bg-[#121317]" />;
            const isToday = c.dateStr === todayStr;
            const clickable = !!c.info;
            return (
              <div
                key={i}
                onClick={clickable ? () => setDay(c.dateStr) : undefined}
                className={`min-h-[120px] bg-white p-2 dark:bg-[#15171c] ${isToday ? "ring-2 ring-inset ring-brand/40" : ""} ${clickable ? "cursor-pointer transition hover:bg-slate-50 dark:hover:bg-white/[0.03]" : ""}`}
              >
                <div className={`mb-1 text-right text-sm ${isToday ? "font-bold text-brand" : "text-slate-400 dark:text-neutral-500"}`}>{c.dn}</div>
                {c.info && (
                  <div className="space-y-0.5 text-[11px] leading-tight">
                    <div className="text-slate-400 dark:text-neutral-600">{formatMoney(c.info.opening, base)}</div>
                    {c.info.in > 0 && <div className="text-emerald-600 dark:text-emerald-400">+{formatMoney(c.info.in, base)}</div>}
                    {c.info.out > 0 && <div className="text-red-600 dark:text-red-400">−{formatMoney(c.info.out, base)}</div>}
                    <div className={`rounded-md px-1.5 py-0.5 font-semibold ${c.info.net >= 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"}`}>
                      {c.info.net >= 0 ? "+" : "−"}{formatMoney(Math.abs(c.info.net), base)}
                    </div>
                    <div className={`${c.info.closing < 0 ? "text-red-500" : "text-slate-400 dark:text-neutral-600"}`}>{formatMoney(c.info.closing, base)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {day && (
        <DrilldownModal
          open onClose={() => setDay(null)}
          title={`Операции за ${new Date(day).toLocaleDateString("ru-RU")}`}
          filter={{ dateFrom: day, dateTo: day }}
          teamId={teamId} userId={userId} canEdit={canEdit}
        />
      )}
    </div>
  );
}
