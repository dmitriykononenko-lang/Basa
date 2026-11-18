// Тесты математики привязки операции к начислению. Запуск: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidateRemaining, linkInTxCurrency, fxDefaults, crossRate, convertByRate, formatRateDate, fxLabel,
} from "./obligation-link-calc.ts";

test("payment_amount берётся как есть, даже при разных валютах", () => {
  assert.equal(linkInTxCurrency({ amount: 841975, payment_amount: 10000, oblCurrency: "RUB", mine: true }, "USDT"), 10000);
});

test("без payment_amount: та же валюта — fallback amount, другая — null", () => {
  assert.equal(linkInTxCurrency({ amount: 5000, payment_amount: null, oblCurrency: "RUB", mine: true }, "RUB"), 5000);
  assert.equal(linkInTxCurrency({ amount: 5000, payment_amount: null, oblCurrency: "RUB", mine: true }, "USDT"), null);
  assert.equal(linkInTxCurrency({ amount: 5000, payment_amount: undefined, oblCurrency: null, mine: true }, "RUB"), null);
});

test("остаток = min(часть − свои привязки, вся операция − все привязки)", () => {
  const links = [
    { amount: 3000, payment_amount: 3000, oblCurrency: "RUB", mine: true },
    { amount: 6000, payment_amount: 6000, oblCurrency: "RUB", mine: false },
  ];
  // часть контрагента 5000 из 10000: свои 3000 → 2000; вся 10000 − 9000 → 1000
  assert.equal(candidateRemaining({ part: 5000, whole: 10000, currency: "RUB" }, links), 1000);
  assert.equal(candidateRemaining({ part: 5000, whole: 10000, currency: "RUB" }, []), 5000);
});

test("остаток null, если хотя бы одна привязка требует сверки", () => {
  const links = [{ amount: 841975, payment_amount: null, oblCurrency: "RUB", mine: true }];
  assert.equal(candidateRemaining({ part: 10000, whole: 10000, currency: "USDT" }, links), null);
});

test("подсказка курса: без урезания", () => {
  // 100 USDT × 84,1975 = 8 419,75 ₽, долг 10 000 ₽
  assert.deepEqual(fxDefaults(10000, 1000000, 84.1975), { amount: 841975, payment: 10000 });
});

test("подсказка курса: урезано до долга — payment пересчитан обратно", () => {
  // 100 USDT × 84,1975 = 8 419,75 ₽, долг 5 000 ₽ → 5000/84,1975 = 59,38 USDT
  assert.deepEqual(fxDefaults(10000, 500000, 84.1975), { amount: 500000, payment: 5938 });
});

test("кросс-курс и пересчёт", () => {
  assert.equal(crossRate(84.1975, 1), 84.1975);
  assert.ok(Math.abs(crossRate(1, 84.1975) - 0.011876) < 1e-6);
  assert.equal(convertByRate(10000, 84.1975), 841975);
});

test("подписи курса", () => {
  assert.equal(formatRateDate("2026-09-21", 2026), "21.09");
  assert.equal(formatRateDate("2025-09-21", 2026), "21.09.2025");
  assert.equal(fxLabel("IDENTITY", 1, null), "");
  assert.match(fxLabel("CBR", 84.1975, "2026-09-21"), /^по курсу 84,1975 \(ЦБ \d{2}\.09(\.2026)?\)$/);
  assert.match(fxLabel("MANUAL", 85, null), /вручную/);
  assert.match(fxLabel("LEGACY", 90, null), /исторический/);
});
