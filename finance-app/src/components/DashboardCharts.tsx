"use client";

import { PointsChart, type PointsChartDataPoint } from "@/components/ui/points-chart";

// Клиентская обёртка: форматтер-функция живёт здесь (нельзя передавать функции
// из серверного компонента в клиентский). На вход — только сериализуемые данные.
export default function DashboardCharts({
  curSym,
  baseCurrency,
  past,
  trend,
  hasGap,
  gapLabel,
  gapText,
  income,
  expense,
  showFlows,
}: {
  curSym: string;
  baseCurrency: string;
  past: number;
  trend: PointsChartDataPoint[];
  hasGap: boolean;
  gapLabel: string;
  gapText: string;
  income: PointsChartDataPoint[];
  expense: PointsChartDataPoint[];
  showFlows: boolean;
}) {
  const fmt = (v: number) =>
    `${new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(v)} ${curSym}`;

  return (
    <>
      <section className="mt-8">
        <PointsChart
          title="Динамика остатка на счетах"
          data={trend}
          height={240}
          yAxisLabel={curSym}
          valueLabel="Остаток"
          valueFormatter={fmt}
          levels={hasGap ? [{ value: 0, color: "#ef4444" }] : undefined}
          headerRight={
            hasGap ? (
              <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/40">
                ⚠️ Разрыв в {gapLabel}: {gapText}
              </span>
            ) : (
              <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/40">
                Разрывов не прогнозируется
              </span>
            )
          }
        />
        <p className="mt-2 px-1 text-xs text-slate-400 dark:text-neutral-500">
          Факт за {past} мес. · далее — прогноз по плановым операциям и обязательствам ({baseCurrency}).
        </p>
      </section>

      {showFlows && (
        <section className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <PointsChart title="Доходы по месяцам" data={income} height={200} valueLabel="Доход" valueFormatter={fmt} />
          <PointsChart title="Расходы по месяцам" data={expense} height={200} valueLabel="Расход" valueFormatter={fmt} />
        </section>
      )}
    </>
  );
}
