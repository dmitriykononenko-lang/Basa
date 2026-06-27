// Типы и помощники модуля «Показатели» (KPI с план/факт по периодам).

export type MetricPeriod = "day" | "week" | "month";
export type MetricDirection = "up_good" | "down_good";
export type MetricAgg = "sum" | "avg" | "last";

export type Metric = {
  id: string;
  team_id: string;
  name: string;
  unit: string;
  owner_user_id: string | null;
  unit_id: string | null;
  period: MetricPeriod;
  direction: MetricDirection;
  aggregation: MetricAgg;
  plan: number | null;
  is_active: boolean;
  sort: number;
};

export type MetricValue = {
  id: string;
  metric_id: string;
  period_start: string; // YYYY-MM-DD
  value: number;
  note: string;
};

export const PERIOD_LABELS: Record<MetricPeriod, string> = {
  day: "День",
  week: "Неделя",
  month: "Месяц",
};
export const DIRECTION_LABELS: Record<MetricDirection, string> = {
  up_good: "Рост — лучше",
  down_good: "Снижение — лучше",
};
export const AGG_LABELS: Record<MetricAgg, string> = {
  sum: "Сумма",
  avg: "Среднее",
  last: "Последнее",
};

// Начало периода (UTC, сервер Vercel в UTC), к которому относится дата d.
export function periodStart(d: Date, period: MetricPeriod): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (period === "month") {
    x.setUTCDate(1);
  } else if (period === "week") {
    const dow = (x.getUTCDay() + 6) % 7; // 0 = понедельник
    x.setUTCDate(x.getUTCDate() - dow);
  }
  return x.toISOString().slice(0, 10);
}

// Сдвиг периода на n шагов (n<0 — назад).
export function addPeriods(periodStartStr: string, period: MetricPeriod, n: number): string {
  const [y, m, d] = periodStartStr.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d));
  if (period === "day") x.setUTCDate(x.getUTCDate() + n);
  else if (period === "week") x.setUTCDate(x.getUTCDate() + 7 * n);
  else x.setUTCMonth(x.getUTCMonth() + n);
  return x.toISOString().slice(0, 10);
}

// Последние `count` начал периодов, заканчивая текущим (по возрастанию).
export function recentPeriodStarts(today: Date, period: MetricPeriod, count: number): string[] {
  const cur = periodStart(today, period);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addPeriods(cur, period, -i));
  return out;
}

export function periodLabel(periodStartStr: string, period: MetricPeriod): string {
  const [y, m, d] = periodStartStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (period === "month") return dt.toLocaleDateString("ru-RU", { month: "short", year: "numeric", timeZone: "UTC" });
  if (period === "week") return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}`;
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", timeZone: "UTC" });
}

// Выполнение плана с учётом направления. pct — % к плану (для прогресс-бара),
// good — достигнут ли план (null если данных нет).
export function achievement(
  value: number | null,
  plan: number | null,
  direction: MetricDirection,
): { pct: number | null; good: boolean | null } {
  if (value == null || plan == null) return { pct: null, good: null };
  const good = direction === "up_good" ? value >= plan : value <= plan;
  if (plan === 0) return { pct: null, good };
  const pct = direction === "up_good" ? (value / plan) * 100 : (plan / value) * 100;
  return { pct: Number.isFinite(pct) ? pct : null, good };
}

export function formatMetric(value: number | null | undefined, unit: string): string {
  if (value == null) return "—";
  const n = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
  return unit ? `${n} ${unit}` : n;
}
