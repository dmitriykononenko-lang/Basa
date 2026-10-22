// Тесты остатка «нераспределённой» операции (после 0099 — по payment_amount).
// Запуск: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcUnallocated, hasUnallocatedRemainder } from "./unallocated-calc.ts";

const rates = { RUB: 1, USDT: 84.1975 };
const toBase = (m, c) => (rates[c] === undefined ? m : Math.round(m * rates[c]));

test("без привязок: весь платёж не разнесён", () => {
  const c = calcUnallocated({ amount: 10000, currency: "USDT" }, [], toBase);
  assert.equal(c.exact, true);
  assert.equal(c.remaining, 10000);
  assert.equal(c.paidBase, 841975);
  assert.equal(c.remainingBase, 841975);
  assert.equal(c.allocatedBase, 0);
  assert.equal(hasUnallocatedRemainder(c), true);
});

test("USDT-выплата к рублёвому начислению: остаток по payment_amount, без FX", () => {
  // 100 USDT, привязано 60 USDT → 5 000 ₽ по ручному курсу (amount в рублях ≠ 60×курс)
  const c = calcUnallocated(
    { amount: 10000, currency: "USDT" },
    [{ amount: 500000, payment_amount: 6000 }],
    toBase
  );
  assert.equal(c.remaining, 4000);
  assert.equal(c.remainingBase, Math.round(4000 * 84.1975));
  assert.equal(c.allocatedBase, c.paidBase - c.remainingBase);
  assert.equal(hasUnallocatedRemainder(c), true);
});

test("разнесено полностью по payment_amount → остатка нет, даже если amount в рублях меньше", () => {
  const c = calcUnallocated(
    { amount: 10000, currency: "USDT" },
    [{ amount: 100, payment_amount: 4000 }, { amount: 200, payment_amount: 6000 }],
    toBase
  );
  assert.equal(c.remaining, 0);
  assert.equal(hasUnallocatedRemainder(c), false);
});

test("рубли к рублям: payment_amount = amount", () => {
  const c = calcUnallocated(
    { amount: 100000, currency: "RUB" },
    [{ amount: 30000, payment_amount: 30000 }],
    toBase
  );
  assert.equal(c.remaining, 70000);
  assert.equal(c.remainingBase, 70000);
});

test("до 0099 (payment_amount нет): прежний расчёт в базовой валюте", () => {
  const c = calcUnallocated(
    { amount: 10000, currency: "USDT" },
    [{ amount: 500000, payment_amount: undefined }],
    toBase
  );
  assert.equal(c.exact, false);
  assert.equal(c.remaining, null);
  assert.equal(c.paidBase, 841975);
  assert.equal(c.allocatedBase, 500000);
  assert.equal(c.remainingBase, 341975);
  assert.equal(hasUnallocatedRemainder(c), true);
});

test("смешанные строки: payment_amount переводится в базовую, null-строка — amount как есть", () => {
  const c = calcUnallocated(
    { amount: 10000, currency: "USDT" },
    [{ amount: 500000, payment_amount: null }, { amount: 1, payment_amount: 4000 }],
    toBase
  );
  assert.equal(c.exact, false);
  assert.equal(c.allocatedBase, 500000 + Math.round(4000 * 84.1975));
  assert.equal(c.remainingBase, 841975 - c.allocatedBase);
  assert.equal(hasUnallocatedRemainder(c), c.remainingBase > 0);
});
