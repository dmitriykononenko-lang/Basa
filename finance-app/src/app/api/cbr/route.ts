import { NextResponse } from "next/server";

// Курсы ЦБ РФ на сегодня (RUB за 1 единицу валюты).
// Источник — ежедневный JSON ЦБ. USDT ЦБ не котирует → приравниваем к USD (пеговый стейблкоин).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch("https://www.cbr-xml-daily.ru/daily_json.js", { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `ЦБ вернул ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as {
      Date?: string;
      Valute?: Record<string, { Value?: number; Nominal?: number }>;
    };
    const rates: Record<string, number> = {};
    const valute = data.Valute ?? {};
    for (const code of Object.keys(valute)) {
      const item = valute[code];
      if (item?.Value && item?.Nominal) {
        rates[code] = item.Value / item.Nominal;
      }
    }
    if (rates.USD) rates.USDT = rates.USD; // стейблкоин ≈ доллар
    return NextResponse.json({ date: data.Date ?? null, rates });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Не удалось получить курсы ЦБ" },
      { status: 502 },
    );
  }
}
