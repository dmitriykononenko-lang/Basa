// Рабочие дни (пн–пт, без праздников). Зеркало SQL business_days/business_day_add.

function parse(d: string): Date {
  return new Date(d + "T00:00:00");
}
function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function isWeekday(d: Date): boolean {
  const g = d.getDay(); // 0=вс, 6=сб
  return g !== 0 && g !== 6;
}

// Число будних дней в интервале (from, to]; 0 если to <= from.
export function businessDaysBetween(from: string, to: string): number {
  if (!from || !to) return 0;
  const a = parse(from);
  const b = parse(to);
  if (b <= a) return 0;
  let n = 0;
  const cur = new Date(a);
  for (;;) {
    cur.setDate(cur.getDate() + 1);
    if (cur > b) break;
    if (isWeekday(cur)) n++;
  }
  return n;
}

// Прибавить n рабочих дней к дате. null если days не задан.
export function addBusinessDays(from: string, days: number | null | undefined): string | null {
  if (days == null) return null;
  const cur = parse(from);
  if (days <= 0) return iso(cur);
  let left = days;
  while (left > 0) {
    cur.setDate(cur.getDate() + 1);
    if (isWeekday(cur)) left--;
  }
  return iso(cur);
}

// Эффективный срок: явная дата или старт + норматив рабочих дней.
export function effectiveDue(
  start: string,
  planWorkDays: number | null | undefined,
  dueDate: string | null | undefined
): string | null {
  return dueDate ?? addBusinessDays(start, planWorkDays ?? null);
}

export function pluralizeRu(n: number, forms: [string, string, string] = ["день", "дня", "дней"]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

// Удобный ярлык «N раб. дней»
export function workdaysLabel(n: number): string {
  return `${n} раб. ${pluralizeRu(n)}`;
}
