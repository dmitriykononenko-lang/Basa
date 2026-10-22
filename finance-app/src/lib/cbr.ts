// Курсы ЦБ РФ. Источник — cbr-xml-daily.ru (JSON-зеркало официального ЦБ).
// Курсы в формате «1 единица валюты = N рублей» (с учётом номинала).
// USDT приравниваем к USD (стейблкоин ≈ доллар), т.к. ЦБ не котирует крипту.
//
// Модуль без зависимостей (ни Next, ни Supabase): разбор ответа и перебор дат
// покрыты тестами cbr.test.mjs, fetch туда подставляется.

export type CbrRates = {
  rates: Record<string, number>; // RUB за 1 единицу валюты
  date: string | null; // дата котировки ЦБ (ISO)
};

const CBR_URL = "https://www.cbr-xml-daily.ru/daily_json.js";
const CBR_ARCHIVE_URL = "https://www.cbr-xml-daily.ru/archive";

type CbrJson = {
  Date?: string;
  Valute?: Record<string, { Nominal?: number; Value?: number }>;
};

// Чистый разбор ответа daily_json.js / archive/.../daily_json.js.
// Возвращает RUB за 1 единицу (Value / Nominal), RUB = 1, USDT = USD.
// date — дата котировки (YYYY-MM-DD из поля Date, по московскому времени ЦБ).
export function parseCbrDaily(data: unknown): CbrRates {
  const d = (data ?? {}) as CbrJson;
  const out: Record<string, number> = {};
  const valute = d.Valute && typeof d.Valute === "object" ? d.Valute : {};
  for (const [code, v] of Object.entries(valute)) {
    const nominal = Number(v?.Nominal) || 1;
    const value = Number(v?.Value);
    if (Number.isFinite(value) && value > 0 && nominal > 0) {
      // Убираем «хвосты» деления (100 JPY и т.п.): 6 знаков достаточно для подсказки.
      out[code] = Math.round((value / nominal) * 1e6) / 1e6;
    }
  }
  if (out.USD !== undefined) out.USDT = out.USD;
  out.RUB = 1;
  const m = typeof d.Date === "string" ? /^(\d{4}-\d{2}-\d{2})/.exec(d.Date) : null;
  return { rates: out, date: m ? m[1] : null };
}

export async function fetchCbrRates(): Promise<CbrRates> {
  try {
    const res = await fetch(CBR_URL, {
      // Курсы ЦБ обновляются раз в сутки — кэшируем на час.
      next: { revalidate: 3600 },
    });
    if (!res.ok) return { rates: {}, date: null };
    const parsed = parseCbrDaily(await res.json());
    // Исторически здесь не было RUB — не меняем поведение для вызывающих.
    delete parsed.rates.RUB;
    return parsed;
  } catch {
    return { rates: {}, date: null };
  }
}

// ---------- Курс на дату (подсказка для привязки разновалютных выплат) ----------

export type CbrRateOnDate = { rate: number; rate_date: string; source: "cbr-xml-daily" };

/** Сеть/ЦБ недоступны (таймаут, 5xx, битый JSON) — маршрут отвечает 502. */
export class CbrUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CbrUnavailableError";
  }
}

/** Сколько дней назад шагаем от запрошенной даты (выходные/праздники → 404 в архиве). */
export const CBR_MAX_STEP_BACK_DAYS = 10;
/** Общий бюджет времени на один getCbrRate (все попытки вместе). */
export const CBR_TOTAL_BUDGET_MS = 15_000;
const FETCH_TIMEOUT_MS = 5000;
// TTL кэша дневных ответов:
// - архив за прошлый день, где курс опубликован, — не меняется, бессрочно;
// - текущий daily_json.js, архив за сегодня и «404 за день» — час
//   (ЦБ публикует курс на завтра днём, архив может появиться позже).
const SHORT_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 1000;

type FetchLike = (url: string, init?: { signal?: AbortSignal; cache?: RequestCache }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type GetCbrRateOptions = {
  fetchImpl?: FetchLike;
  /** Сегодняшняя дата YYYY-MM-DD (по Москве); для тестов. */
  today?: string;
  /** Таймаут одного запроса, мс. */
  timeoutMs?: number;
  /** Общий бюджет на все попытки, мс. */
  budgetMs?: number;
  /** Текущее время, мс; для тестов TTL. */
  now?: () => number;
};

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Корректная календарная дата YYYY-MM-DD не раньше 2000-01-01. */
export function isValidCbrDate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Самая поздняя допустимая дата запроса: завтра по Москве (ЦБ публикует курс на день вперёд). */
export function maxCbrDate(today: string = moscowToday()): string {
  return shiftIsoDate(today, 1);
}

/** Код валюты из запроса: 3–5 латинских заглавных. */
export function normalizeCbrCurrency(s: string | null | undefined): string | null {
  const c = (s ?? "").trim().toUpperCase();
  return /^[A-Z]{3,5}$/.test(c) ? c : null;
}

export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Сегодня по Москве (UTC+3, без перехода на летнее время). */
export function moscowToday(now: number = Date.now()): string {
  return new Date(now + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export function cbrArchiveUrl(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${CBR_ARCHIVE_URL}/${y}/${m}/${d}/daily_json.js`;
}

/** Код, под которым валюта есть в ответе ЦБ (USDT котируется как USD). */
function cbrCode(currency: string): string {
  return currency === "USDT" ? "USD" : currency;
}

// Кэш в памяти процесса: URL дневного ответа → разобранные курсы всех валют
// (null = 404, за этот день курса нет). Один день обслуживает любые валюты.
const cache = new Map<string, { value: CbrRates | null; expires: number }>();

export function clearCbrCache(): void {
  cache.clear();
}

function cacheSet(key: string, value: CbrRates | null, expires: number) {
  cache.delete(key);
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expires });
}

type Ctx = { fetchImpl: FetchLike; timeoutMs: number; deadline: number; now: () => number };

// Дневной ответ ЦБ: из кэша или сетью. null — 404 (выходной/праздник/ещё не опубликовано).
async function loadDay(url: string, shortTtl: boolean, ctx: Ctx): Promise<CbrRates | null> {
  const hit = cache.get(url);
  if (hit && hit.expires > ctx.now()) return hit.value;

  const left = ctx.deadline - ctx.now();
  if (left <= 0) throw new CbrUnavailableError("ЦБ не ответил вовремя");
  let res;
  try {
    res = await ctx.fetchImpl(url, {
      signal: AbortSignal.timeout(Math.min(ctx.timeoutMs, left)),
      cache: "no-store",
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new CbrUnavailableError(timeout ? "ЦБ не ответил вовремя" : "Не удалось связаться с ЦБ");
  }
  let value: CbrRates | null;
  if (res.status === 404) {
    value = null;
  } else if (!res.ok) {
    throw new CbrUnavailableError(`ЦБ вернул ${res.status}`);
  } else {
    try {
      value = parseCbrDaily(await res.json());
    } catch {
      throw new CbrUnavailableError("ЦБ вернул некорректный ответ");
    }
  }
  const forever = value !== null && !shortTtl;
  cacheSet(url, value, forever ? Number.POSITIVE_INFINITY : ctx.now() + SHORT_TTL_MS);
  return value;
}

/**
 * Курс ЦБ (RUB за 1 единицу `currency`) на дату `date`.
 * Прошлое и сегодня — архив; на 404 шагаем назад до CBR_MAX_STEP_BACK_DAYS дней,
 * rate_date — фактическая дата котировки. Завтра — текущий daily_json.js.
 * Позже завтрашнего дня (по Москве) — RangeError (маршрут отвечает 400 раньше).
 * Возвращает null, если курса нет; бросает CbrUnavailableError при сбое сети
 * или исчерпании общего бюджета CBR_TOTAL_BUDGET_MS.
 * Вход должен быть провалидирован (isValidCbrDate / normalizeCbrCurrency).
 */
export async function getCbrRate(
  currency: string,
  date: string,
  opts: GetCbrRateOptions = {}
): Promise<CbrRateOnDate | null> {
  const now = opts.now ?? Date.now;
  const today = opts.today ?? moscowToday(now());
  if (date > maxCbrDate(today)) throw new RangeError("Дата позже завтрашнего дня");
  if (currency === "RUB") return { rate: 1, rate_date: date, source: "cbr-xml-daily" };

  const ctx: Ctx = {
    fetchImpl: opts.fetchImpl ?? (fetch as unknown as FetchLike),
    timeoutMs: opts.timeoutMs ?? FETCH_TIMEOUT_MS,
    deadline: now() + (opts.budgetMs ?? CBR_TOTAL_BUDGET_MS),
    now,
  };
  const code = cbrCode(currency);
  const pick = (day: CbrRates, fallbackDate: string): CbrRateOnDate | null => {
    const rate = day.rates[code];
    return rate === undefined ? null : { rate, rate_date: day.date ?? fallbackDate, source: "cbr-xml-daily" };
  };

  if (date > today) {
    const day = await loadDay(CBR_URL, true, ctx);
    return day ? pick(day, today) : null;
  }
  for (let back = 0; back <= CBR_MAX_STEP_BACK_DAYS; back++) {
    const iso = shiftIsoDate(date, -back);
    const day = await loadDay(cbrArchiveUrl(iso), iso >= today, ctx);
    // Нашли опубликованный день: если валюты в нём нет, ЦБ её не котирует — дальше не ищем.
    if (day) return pick(day, iso);
  }
  return null;
}
