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
