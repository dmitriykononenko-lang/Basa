// Тесты курса ЦБ: разбор ответа cbr-xml-daily и перебор дат назад (fetch замокан).
// Запуск: npm test.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseCbrDaily,
  getCbrRate,
  clearCbrCache,
  isValidCbrDate,
  normalizeCbrCurrency,
  cbrArchiveUrl,
  shiftIsoDate,
  CbrUnavailableError,
  CBR_MAX_STEP_BACK_DAYS,
} from "./cbr.ts";

const day = (iso, valute) => ({ Date: `${iso}T11:30:00+03:00`, Valute: valute });
const USD = { Nominal: 1, Value: 84.1975 };
const JPY = { Nominal: 100, Value: 55.1234 };

function mockFetch(byUrl) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const v = byUrl[url];
    if (v instanceof Error) throw v;
    if (v === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (typeof v === "number") return { ok: v < 400, status: v, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => v };
  };
  return { impl, calls };
}

beforeEach(() => clearCbrCache());

test("parseCbrDaily: Value/Nominal, USDT=USD, RUB=1, дата котировки", () => {
  const r = parseCbrDaily(day("2026-09-19", { USD, JPY, BAD: { Nominal: 1, Value: 0 } }));
  assert.equal(r.date, "2026-09-19");
  assert.equal(r.rates.USD, 84.1975);
  assert.equal(r.rates.USDT, 84.1975);
  assert.equal(r.rates.RUB, 1);
  assert.equal(r.rates.JPY, 0.551234);
  assert.equal(r.rates.BAD, undefined);
});

test("parseCbrDaily: мусор на входе не падает", () => {
  assert.deepEqual(parseCbrDaily(null), { rates: { RUB: 1 }, date: null });
  assert.deepEqual(parseCbrDaily({ Valute: "x" }), { rates: { RUB: 1 }, date: null });
});

test("валидация параметров", () => {
  assert.equal(isValidCbrDate("2026-09-21"), true);
  assert.equal(isValidCbrDate("2000-01-01"), true);
  assert.equal(isValidCbrDate("1999-12-31"), false);
  assert.equal(isValidCbrDate("2026-02-30"), false);
  assert.equal(isValidCbrDate("2026-9-1"), false);
  assert.equal(isValidCbrDate("2026-09-21T00:00"), false);
  assert.equal(normalizeCbrCurrency("usdt"), "USDT");
  assert.equal(normalizeCbrCurrency("EU"), null);
  assert.equal(normalizeCbrCurrency("../x"), null);
  assert.equal(normalizeCbrCurrency(null), null);
  assert.equal(cbrArchiveUrl("2026-09-01"), "https://www.cbr-xml-daily.ru/archive/2026/09/01/daily_json.js");
  assert.equal(shiftIsoDate("2026-03-01", -1), "2026-02-28");
});

test("RUB → 1 без запросов", async () => {
  const { impl, calls } = mockFetch({});
  const r = await getCbrRate("RUB", "2026-09-20", { fetchImpl: impl, today: "2026-10-22" });
  assert.deepEqual(r, { rate: 1, rate_date: "2026-09-20", source: "cbr-xml-daily" });
  assert.equal(calls.length, 0);
});

test("выходные: шагаем назад до опубликованного дня, rate_date фактическая", async () => {
  const { impl, calls } = mockFetch({ [cbrArchiveUrl("2026-09-19")]: day("2026-09-19", { USD }) });
  const r = await getCbrRate("USDT", "2026-09-21", { fetchImpl: impl, today: "2026-10-22" });
  assert.deepEqual(r, { rate: 84.1975, rate_date: "2026-09-19", source: "cbr-xml-daily" });
  assert.deepEqual(calls, [
    cbrArchiveUrl("2026-09-21"),
    cbrArchiveUrl("2026-09-20"),
    cbrArchiveUrl("2026-09-19"),
  ]);
  // Повторный запрос — из кэша
  await getCbrRate("USDT", "2026-09-21", { fetchImpl: impl, today: "2026-10-22" });
  assert.equal(calls.length, 3);
});

test("нет курса за 10 дней назад → null после 11 попыток", async () => {
  const { impl, calls } = mockFetch({});
  const r = await getCbrRate("USD", "2026-09-21", { fetchImpl: impl, today: "2026-10-22" });
  assert.equal(r, null);
  assert.equal(calls.length, CBR_MAX_STEP_BACK_DAYS + 1);
});

test("валюта не котируется ЦБ → null без шага назад", async () => {
  const { impl, calls } = mockFetch({ [cbrArchiveUrl("2026-09-21")]: day("2026-09-21", { USD }) });
  const r = await getCbrRate("XYZ", "2026-09-21", { fetchImpl: impl, today: "2026-10-22" });
  assert.equal(r, null);
  assert.equal(calls.length, 1);
});

test("сеть упала / 5xx → CbrUnavailableError, не кэшируется", async () => {
  const net = mockFetch({ [cbrArchiveUrl("2026-09-21")]: new TypeError("fetch failed") });
  await assert.rejects(
    getCbrRate("USD", "2026-09-21", { fetchImpl: net.impl, today: "2026-10-22" }),
    CbrUnavailableError
  );
  const s5 = mockFetch({ [cbrArchiveUrl("2026-09-21")]: 503 });
  await assert.rejects(
    getCbrRate("USD", "2026-09-21", { fetchImpl: s5.impl, today: "2026-10-22" }),
    CbrUnavailableError
  );
  const ok = mockFetch({ [cbrArchiveUrl("2026-09-21")]: day("2026-09-21", { USD }) });
  const r = await getCbrRate("USD", "2026-09-21", { fetchImpl: ok.impl, today: "2026-10-22" });
  assert.equal(r?.rate, 84.1975);
});

test("будущая дата → текущий daily_json.js", async () => {
  const { impl, calls } = mockFetch({
    "https://www.cbr-xml-daily.ru/daily_json.js": day("2026-10-23", { USD }),
  });
  const r = await getCbrRate("USD", "2026-10-30", { fetchImpl: impl, today: "2026-10-22" });
  assert.deepEqual(r, { rate: 84.1975, rate_date: "2026-10-23", source: "cbr-xml-daily" });
  assert.equal(calls.length, 1);
});
