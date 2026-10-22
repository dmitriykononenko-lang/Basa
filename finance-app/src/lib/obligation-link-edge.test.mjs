// QA: граничные случаи привязки (Q-09, 0099). Запуск: npm test.
// Инварианты, которые сверяет RPC obligation_link: amount ≤ outstanding (валюта начисления),
// payment ≤ available (валюта операции), обе > 0; для CBR — |amount − payment × p_fx_rate| ≤ max(rate, 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fxDefaults, cbrFromPayment, withinCbrTolerance, crossRate, convertByRate, candidateRemaining } from "./obligation-link-calc.ts";
import { calcUnallocated, hasUnallocatedRemainder } from "./unallocated-calc.ts";

const id = (m) => m; // toBase для базовой валюты

test("fxDefaults: инварианты RPC на сетке сумм и курсов", () => {
  const rates = [84.1975, 80.1234, 1, crossRate(1, 80.1234), crossRate(84.1975, 92.3456)];
  for (const rate of rates) {
    for (const available of [1, 99, 10000, 123457, 1e9]) {
      for (const outstanding of [1, 50, 100000, 7777777]) {
        const d = fxDefaults(available, outstanding, rate);
        assert.ok(d.amount <= outstanding, `amount ${d.amount} > outstanding ${outstanding} @${rate}`);
        assert.ok(d.payment <= available, `payment ${d.payment} > available ${available} @${rate}`);
        assert.ok(d.payment >= 1, "payment ≥ 1");
        assert.ok(Number.isInteger(d.amount) && Number.isInteger(d.payment), "целые минорные");
        // подсказка (в т.ч. урезанная до долга) проходит проверку RPC как CBR
        assert.ok(withinCbrTolerance(d.amount, d.payment, rate), `CBR-допуск: ${d.amount} vs ${d.payment}×${rate}`);
      }
    }
  }
});

test("крошечный остаток: amount = 0 — форма показывает «меньше 1 копейки/0,01», к RPC не уходит", () => {
  // 0,30 ₽ по курсу 1/80,1234 = 0,0037 $ → 0 центов
  const d = cbrFromPayment(30, 100000, crossRate(1, 80.1234));
  assert.equal(d.amount, 0);
  assert.equal(d.payment, 30);
  assert.equal(d.capped, false);
});

test("урезание до долга остаётся CBR: пара в допуске RPC, подпись — по фактическим полям", () => {
  const rate = 80.1234;
  const d = cbrFromPayment(10000, 100000, rate); // 100 $ против долга 1 000 ₽
  assert.deepEqual(d, { amount: 100000, payment: 1248, capped: true });
  // payment × курс = 999,94 ₽, в поле 1 000,00 ₽ — расхождение 6 коп. < max(курс, 1): RPC примет как CBR
  assert.equal(convertByRate(d.payment, rate), 99994);
  assert.ok(withinCbrTolerance(d.amount, d.payment, rate));
});

test("правка «Списать из операции» в режиме ЦБ: рубли не больше долга, списание пересчитано обратно", () => {
  const rate = 84.1975;
  assert.deepEqual(cbrFromPayment(5000, 1000000, rate), { amount: 420988, payment: 5000, capped: false });
  const d = cbrFromPayment(50000, 1000000, rate); // 500 USDT ≈ 42 098,75 ₽ при долге 10 000 ₽
  assert.equal(d.amount, 1000000);
  assert.equal(d.payment, 11877);
  assert.ok(d.payment <= 50000);
  assert.ok(withinCbrTolerance(d.amount, d.payment, rate));
});

test("долг меньше одной единицы платежа по курсу: payment = 1, всё ещё в допуске", () => {
  const d = cbrFromPayment(10000, 30, 84.1975); // долг 0,30 ₽, 1 цент USDT = 0,84 ₽
  assert.deepEqual(d, { amount: 30, payment: 1, capped: true });
  assert.ok(withinCbrTolerance(d.amount, d.payment, 84.1975));
});

test("fxDefaults: курс 1 (одна валюта по сути) — без потерь", () => {
  assert.deepEqual(fxDefaults(5000, 3000, 1), { amount: 3000, payment: 3000 });
  assert.deepEqual(fxDefaults(3000, 5000, 1), { amount: 3000, payment: 3000 });
});

test("candidateRemaining: перепривязанная операция → отрицательный остаток (кандидат отфильтрован)", () => {
  const r = candidateRemaining({ part: 100, whole: 100, currency: "RUB" },
    [{ amount: 150, payment_amount: 150, oblCurrency: "RUB", mine: true }]);
  assert.equal(r, -50);
});

test("candidateRemaining: чужие привязки ограничивают только «всю операцию»", () => {
  // часть контрагента 4000 из 10000; чужие привязки 7000 → вся 3000, своя 4000 → 3000
  const links = [{ amount: 7000, payment_amount: 7000, oblCurrency: "RUB", mine: false }];
  assert.equal(candidateRemaining({ part: 4000, whole: 10000, currency: "RUB" }, links), 3000);
});

test("candidateRemaining: кросс-валютная привязка считается по payment_amount, не по amount", () => {
  // USDT-операция 100 $, к рублёвому начислению привязано 8 419,75 ₽ = 100 $ → остаток 0
  const links = [{ amount: 841975, payment_amount: 10000, oblCurrency: "RUB", mine: true }];
  assert.equal(candidateRemaining({ part: 10000, whole: 10000, currency: "USDT" }, links), 0);
});

test("calcUnallocated: пустые привязки — весь платёж, exact", () => {
  const c = calcUnallocated({ amount: 5000, currency: "RUB" }, [], id);
  assert.equal(c.remaining, 5000);
  assert.equal(c.exact, true);
  assert.ok(hasUnallocatedRemainder(c));
});

test("calcUnallocated: перепривязка → отрицательный остаток не показывается", () => {
  const c = calcUnallocated({ amount: 5000, currency: "RUB" }, [{ amount: 6000, payment_amount: 6000 }], id);
  assert.equal(c.remaining, -1000);
  assert.equal(hasUnallocatedRemainder(c), false);
});

test("calcUnallocated: нулевая операция — ничего не разносить", () => {
  const c = calcUnallocated({ amount: 0, currency: "RUB" }, [], id);
  assert.equal(hasUnallocatedRemainder(c), false);
});
