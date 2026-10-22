// Пересчёт валют в основную валюту команды.
// Курс хранится как «1 единица валюты = rate единиц базовой валюты».

export type RateMap = Record<string, number>;

export function buildRateMap(
  rows: { currency: string; rate: number; rate_date: string }[],
  base: string
): RateMap {
  const map: RateMap = { [base]: 1 };
  const latest: Record<string, { rate: number; date: string }> = {};
  for (const r of rows) {
    const cur = latest[r.currency];
    if (!cur || r.rate_date > cur.date) {
      latest[r.currency] = { rate: Number(r.rate), date: r.rate_date };
    }
  }
  for (const c of Object.keys(latest)) map[c] = latest[c].rate;
  return map;
}

// Возвращает сумму в минорных единицах базовой валюты.
// Если курс неизвестен — считаем 1:1 (вызывающий код может подсветить это).
export function toBase(minor: number, currency: string, rates: RateMap): number {
  const r = rates[currency];
  if (r === undefined) return minor;
  return Math.round(minor * r);
}

// Список валют без известного курса (для предупреждений)
export function missingRates(
  currencies: string[],
  rates: RateMap,
  base: string
): string[] {
  return [...new Set(currencies)].filter(
    (c) => c !== base && rates[c] === undefined
  );
}

// Строгий пересчёт: null, если курса нет (в отличие от toBase, который молча
// считает 1:1). Для экранов, где такие суммы нельзя смешивать с базовой валютой.
export function toBaseStrict(minor: number, currency: string, rates: RateMap): number | null {
  const r = rates[currency];
  if (r === undefined) return null;
  return Math.round(minor * r);
}

// Сумма набора (сумма, валюта) в базовой валюте + то, что пересчитать нельзя
// (нет курса), отдельно по валютам в исходных минорных единицах.
export function sumToBase(
  items: { amount: number; currency: string }[],
  rates: RateMap
): { base: number; unconverted: [string, number][] } {
  let base = 0;
  const rest = new Map<string, number>();
  for (const it of items) {
    const v = toBaseStrict(it.amount, it.currency, rates);
    if (v === null) rest.set(it.currency, (rest.get(it.currency) ?? 0) + it.amount);
    else base += v;
  }
  return { base, unconverted: [...rest.entries()] };
}

// Последний курс каждой валюты вместе с датой — чтобы показывать «по курсу X от ДД.ММ.ГГГГ».
export function latestRates(
  rows: { currency: string; rate: number; rate_date: string }[]
): Record<string, { rate: number; date: string }> {
  const latest: Record<string, { rate: number; date: string }> = {};
  for (const r of rows) {
    const cur = latest[r.currency];
    if (!cur || r.rate_date > cur.date) latest[r.currency] = { rate: Number(r.rate), date: r.rate_date };
  }
  return latest;
}
