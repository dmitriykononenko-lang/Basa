// Курсы ЦБ РФ на сегодня. Источник — cbr-xml-daily.ru (JSON-зеркало официального ЦБ).
// Возвращает курсы в формате «1 единица валюты = N рублей» (с учётом номинала).
// USDT приравниваем к USD (стейблкоин ≈ доллар), т.к. ЦБ не котирует крипту.

export type CbrRates = {
  rates: Record<string, number>; // RUB за 1 единицу валюты
  date: string | null; // дата котировки ЦБ (ISO)
};

const CBR_URL = "https://www.cbr-xml-daily.ru/daily_json.js";

export async function fetchCbrRates(): Promise<CbrRates> {
  try {
    const res = await fetch(CBR_URL, {
      // Курсы ЦБ обновляются раз в сутки — кэшируем на час.
      next: { revalidate: 3600 },
    });
    if (!res.ok) return { rates: {}, date: null };
    const data = (await res.json()) as {
      Date?: string;
      Valute?: Record<string, { Nominal?: number; Value?: number }>;
    };
    const out: Record<string, number> = {};
    for (const [code, v] of Object.entries(data.Valute ?? {})) {
      const nominal = Number(v.Nominal) || 1;
      const value = Number(v.Value);
      if (value > 0) out[code] = value / nominal;
    }
    // USDT ≈ USD
    if (out.USD !== undefined) out.USDT = out.USD;
    return { rates: out, date: data.Date ?? null };
  } catch {
    return { rates: {}, date: null };
  }
}
