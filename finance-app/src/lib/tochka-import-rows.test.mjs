// Тесты построения строк импорта Точки. Запуск: npm test (node --test, Node ≥ 23
// сам снимает типы с .ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTochkaRows } from "./tochka-import-rows.ts";

const TARGET = "acc-target";      // счёт Basa, выписка которого импортируется
const SIBLING = "acc-sibling";    // другой свой счёт, тоже есть в getAccounts
const ARCHIVE = "acc-archive";    // архивный свой счёт: только accounts.number
const N_TARGET = "40802810520000300658";
const N_SIBLING = "40802810520000093786";
const N_ARCHIVE = "40802810520000183872";
const N_UNKNOWN = "40802810520000999999";

const ctx = {
  statementNumbers: new Set([N_TARGET, N_SIBLING]),
  ownAccounts: new Map([[N_TARGET, TARGET], [N_SIBLING, SIBLING], [N_ARCHIVE, ARCHIVE]]),
  targetAccountId: TARGET,
  defaultIncomeCat: "cat-in",
  defaultExpenseCat: "cat-out",
};

let seq = 0;
function op(over) {
  return {
    transactionId: `tx-${++seq}`,
    direction: "income",
    amountMinor: 100000,
    currency: "RUB",
    date: "2026-10-01",
    counterpartyName: "ООО Ромашка",
    counterpartyAccount: "40702810000000000001",
    counterpartyInn: "7700000000",
    counterpartyKpp: null,
    description: "Оплата по счёту",
    docNumber: null,
    docType: null,
    ...over,
  };
}

// Изменение баланса счёта по строке — как во вью account_balances.
function delta(row, accountId) {
  let d = 0;
  if (row.type === "income" && row.account_id === accountId) d += row.amount;
  if (row.type === "expense" && row.account_id === accountId) d -= row.amount;
  if (row.type === "transfer" && row.account_id === accountId) d -= row.amount;
  if (row.type === "transfer" && row.transfer_account_id === accountId) d += row.amount;
  return d;
}

function one(o, c = ctx) {
  const r = buildTochkaRows([o], c);
  assert.equal(r.rows.length, 1);
  return r;
}

test("входящий перевод собственных средств с архивного счёта (accounts.number) — приход", () => {
  const { rows: [row], transfers } = one(op({
    direction: "income", counterpartyAccount: N_ARCHIVE, description: "Перевод собственных средств",
  }));
  assert.equal(row.type, "transfer");
  assert.equal(row.account_id, ARCHIVE);
  assert.equal(row.transfer_account_id, TARGET);
  assert.equal(delta(row, TARGET), 100000);
  assert.equal(delta(row, ARCHIVE), -100000);
  assert.equal(row.category_id, null);
  assert.equal(row.counterparty_key, null);
  assert.equal(transfers, 1);
});

test("входящий перевод собственных средств с неизвестного счёта — приход, не расход", () => {
  const { rows: [row] } = one(op({
    direction: "income", counterpartyAccount: N_UNKNOWN, description: "Перевод собственных средств",
  }));
  assert.equal(row.type, "transfer");
  assert.equal(row.account_id, null);
  assert.equal(row.transfer_account_id, TARGET);
  assert.equal(delta(row, TARGET), 100000);
  assert.match(row.note, /с 40802810520000999999/);
});

test("входящий перевод собственных средств без номера счёта контрагента — приход", () => {
  const { rows: [row] } = one(op({
    direction: "income", counterpartyAccount: null, description: "Перевод собственных средств",
  }));
  assert.equal(delta(row, TARGET), 100000);
});

test("исходящий перевод собственных средств на неизвестный счёт — расход по счёту", () => {
  const { rows: [row] } = one(op({
    direction: "expense", counterpartyAccount: N_UNKNOWN, description: "Перевод собственных средств",
  }));
  assert.equal(row.type, "transfer");
  assert.equal(row.account_id, TARGET);
  assert.equal(row.transfer_account_id, null);
  assert.equal(delta(row, TARGET), -100000);
  assert.match(row.note, /на 40802810520000999999/);
});

test("исходящий перевод на архивный счёт — получатель найден по accounts.number", () => {
  const { rows: [row] } = one(op({
    direction: "expense", counterpartyAccount: N_ARCHIVE, description: "Перевод между счетами",
  }));
  assert.equal(row.type, "transfer");
  assert.equal(row.account_id, TARGET);
  assert.equal(row.transfer_account_id, ARCHIVE);
});

test("исходящий перевод на свой счёт из getAccounts — одна строка со связкой", () => {
  const { rows: [row] } = one(op({ direction: "expense", counterpartyAccount: N_SIBLING }));
  assert.equal(row.type, "transfer");
  assert.equal(row.account_id, TARGET);
  assert.equal(row.transfer_account_id, SIBLING);
});

test("входящая нога со счёта из getAccounts пропускается (учтена его выпиской)", () => {
  const r = buildTochkaRows([op({ direction: "income", counterpartyAccount: N_SIBLING })], ctx);
  assert.equal(r.rows.length, 0);
});

test("«Отчисление в фонд Резерв» на непривязанный свой счёт — перевод, не расход", () => {
  const noArchive = { ...ctx, ownAccounts: new Map([[N_TARGET, TARGET]]) };
  const { rows: [row], counterparties } = one(op({
    direction: "expense", counterpartyAccount: N_ARCHIVE, description: "Отчисление в фонд Резерв",
  }), noArchive);
  assert.equal(row.type, "transfer");
  assert.equal(row.category_id, null);
  assert.equal(row.account_id, TARGET);
  assert.equal(delta(row, TARGET), -100000);
  assert.equal(counterparties.length, 0);
});

test("возврат из фонда (входящее отчисление) — приход", () => {
  const { rows: [row] } = one(op({
    direction: "income", counterpartyAccount: N_UNKNOWN, description: "Отчисление в фонд Резерв",
  }));
  assert.equal(row.type, "transfer");
  assert.equal(delta(row, TARGET), 100000);
});

test("номер счёта контрагента сравнивается без пробелов и разделителей", () => {
  const { rows: [row] } = one(op({
    direction: "income", counterpartyAccount: "40802 81052 0000 183872", description: "Перевод",
  }));
  assert.equal(row.type, "transfer");
  assert.equal(row.account_id, ARCHIVE);
  assert.equal(row.transfer_account_id, TARGET);
});

test("обычные приход и расход не меняются", () => {
  const { rows } = buildTochkaRows([
    op({ direction: "income" }),
    op({ direction: "expense", counterpartyInn: "7800000000", counterpartyName: "ИП Поставщик" }),
  ], ctx);
  assert.deepEqual(rows.map((r) => [r.type, r.account_id, r.transfer_account_id, r.category_id]), [
    ["income", TARGET, null, "cat-in"],
    ["expense", TARGET, null, "cat-out"],
  ]);
  assert.equal(delta(rows[0], TARGET), 100000);
  assert.equal(delta(rows[1], TARGET), -100000);
});

test("нулевые суммы и повторы transactionId отбрасываются", () => {
  const a = op({});
  const r = buildTochkaRows([a, { ...a }, op({ amountMinor: 0 })], ctx);
  assert.equal(r.rows.length, 1);
});
