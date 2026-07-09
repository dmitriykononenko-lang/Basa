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
  return unit ? `${n} ${unit}` : n;
}

// ─── Авто-состояние метрики ──────────────────────────────────────────────────
// «Формулы состояния» зашиты здесь: график/карточки определяют состояние сами
// из ряда значений, направления и плана. Ничего вручную выставлять не нужно.

export type MetricTrend = "up" | "down" | "flat" | "none";
export type MetricStateKey = "growing" | "falling" | "steady" | "problem" | "empty";

export type MetricStatus = {
  trend: MetricTrend; // движение факта в «хорошую» сторону к прошлому периоду
  belowPlan: boolean; // факт хуже плана
  filledCurrent: boolean; // заполнен ли текущий период
  problem: boolean; // требует внимания (ниже плана или не заполнено)
  state: MetricStateKey; // итоговое состояние (приоритет: проблема → рост/падение → стабильно)
  last: number | null;
  prev: number | null;
};

export function metricStatus(
  series: { period_start: string; value: number | null }[],
  metric: { period: MetricPeriod; direction: MetricDirection; plan: number | null },
  today: Date = new Date(),
): MetricStatus {
  const entered = series
    .filter((s): s is { period_start: string; value: number } => s.value != null)
    .slice()
    .sort((a, b) => (a.period_start < b.period_start ? -1 : 1));
  const curStart = periodStart(today, metric.period);
  const filledCurrent = entered.some((v) => v.period_start === curStart);
  if (entered.length === 0) {
    return { trend: "none", belowPlan: false, filledCurrent: false, problem: true, state: "empty", last: null, prev: null };
  }
  const last = entered[entered.length - 1].value;
  const prev = entered.length >= 2 ? entered[entered.length - 2].value : null;
  const { good } = achievement(last, metric.plan, metric.direction);
  const belowPlan = metric.plan != null && good === false;
  let trend: MetricTrend = "none";
  if (prev != null) {
    const improving = metric.direction === "up_good" ? last > prev : last < prev;
    const worsening = metric.direction === "up_good" ? last < prev : last > prev;
    trend = improving ? "up" : worsening ? "down" : "flat";
  }
  const problem = belowPlan || !filledCurrent;
  const state: MetricStateKey = belowPlan
    ? "problem"
    : trend === "up"
      ? "growing"
      : trend === "down"
        ? "falling"
        : "steady";
  return { trend, belowPlan, filledCurrent, problem, state, last, prev };
}

export const STATE_LABELS: Record<MetricStateKey, string> = {
  growing: "Растёт",
  falling: "Падает",
  steady: "Стабильно",
  problem: "Проблема",
  empty: "Нет данных",
};

// Цвет состояния — для точки/бейджа/линии графика.
export function stateColor(state: MetricStateKey): string {
  return state === "growing"
    ? "#10b981"
    : state === "falling"
      ? "#f59e0b"
      : state === "problem"
        ? "#ef4444"
        : "#94a3b8";
}
