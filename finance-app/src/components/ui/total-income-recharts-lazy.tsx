"use client";

import dynamic from "next/dynamic";
import type { SeriesPoint } from "./metric-chart";

type Source = { name: string; amount: number; share: number };
type Props = { points: SeriesPoint[]; sources: Source[]; sym?: string; title?: string };

// recharts грузится отдельным чанком только при монтировании (виджет включён).
const Inner = dynamic(() => import("./total-income-recharts"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[300px] w-full items-center justify-center rounded-[28px] border border-border bg-card text-sm text-muted-foreground">
      Загрузка графика…
    </div>
  ),
});

export default function TotalIncomeRechartsLazy(props: Props) {
  return <Inner {...props} />;
}
