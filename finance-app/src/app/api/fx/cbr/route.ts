import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  CbrUnavailableError,
  getCbrRate,
  isValidCbrDate,
  maxCbrDate,
  normalizeCbrCurrency,
} from "@/lib/cbr";

// Подсказка курса ЦБ на дату операции для привязки разновалютной выплаты
// к начислению: GET /api/fx/cbr?currency=USDT&date=YYYY-MM-DD →
// { rate, rate_date, source: "cbr-xml-daily" }, rate = рублей за 1 единицу.
// Только для вошедших пользователей (middleware тоже редиректит, но маршрут
// проверяет сессию сам, чтобы не стать открытым прокси к ЦБ).
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const currency = normalizeCbrCurrency(params.get("currency"));
  const date = (params.get("date") ?? "").trim();
  if (!currency) {
    return NextResponse.json({ error: "Некорректная валюта" }, { status: 400 });
  }
  if (!isValidCbrDate(date)) {
    return NextResponse.json(
      { error: "Некорректная дата: нужен формат YYYY-MM-DD, не раньше 2000-01-01" },
      { status: 400 },
    );
  }
  const maxDate = maxCbrDate();
  if (date > maxDate) {
    return NextResponse.json({ error: `Дата позже ${maxDate}: курса ЦБ ещё нет` }, { status: 400 });
  }

  try {
    const result = await getCbrRate(currency, date);
    if (!result) {
      return NextResponse.json({ error: `Нет курса ЦБ для ${currency} на ${date}` }, { status: 404 });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (e) {
    if (e instanceof CbrUnavailableError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Не удалось получить курс ЦБ" }, { status: 502 });
  }
}
