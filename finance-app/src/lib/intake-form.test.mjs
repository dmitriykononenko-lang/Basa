// Тесты формы клиента и черновика записи. Запуск: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPayload, validatePayload, cleanPayload, draftEntry, isUserAddService } from "./intake-form.ts";

test("amoCRM: без галочки и без пароля — ошибка", () => {
  const p = emptyPayload("amocrm");
  const e = validatePayload(p);
  assert.ok(e.user_added);
  assert.ok(e.account);
});

test("amoCRM: добавил пользователя — пароль не нужен и не сохраняется", () => {
  const p = { ...emptyPayload("amocrm"), account: "maison.amocrm.ru", user_added: true, password: "лишнее", login: "x" };
  assert.deepEqual(validatePayload(p), {});
  const c = cleanPayload(p);
  assert.equal(c.password, "");
  assert.equal(c.login, "");
  const d = draftEntry(c, { clientName: "Maison", agencyEmail: "team@ko.test" });
  assert.equal(d.title, "amoCRM · Maison");
  assert.equal(d.secret, "");
  assert.equal(d.login, "team@ko.test");
  assert.equal(d.url, "https://maison.amocrm.ru");
  assert.match(d.note, /добавил нас пользователем/);
});

test("Meta: запасной вариант — нужны логин и пароль", () => {
  const p = { ...emptyPayload("meta"), fallback: true };
  const e = validatePayload(p);
  assert.ok(e.login && e.password);
  assert.equal(e.user_added, undefined);
  const ok = { ...p, login: "a@b.c", password: "pw", twofa_method: "sms", twofa_where: "+7…12, Анна" };
  assert.deepEqual(validatePayload(ok), {});
  const d = draftEntry(cleanPayload(ok), { clientName: "7S" });
  assert.equal(d.secret, "pw");
  assert.match(d.note, /вместо добавления пользователя/);
  assert.match(d.note, /SMS на телефон — \+7…12, Анна/);
});

test("Другой сервис: нужен сервис, логин, пароль; 2FA по SMS требует «куда»", () => {
  const p = { ...emptyPayload("other"), twofa_method: "sms" };
  const e = validatePayload(p);
  assert.ok(e.service_name && e.login && e.password && e.twofa_where);
  const ok = { ...p, service_name: "Radist", login: "l", password: "p", twofa_where: "почта директора" };
  assert.deepEqual(validatePayload(ok), {});
  assert.equal(isUserAddService("other"), false);
  assert.equal(draftEntry(cleanPayload(ok), { clientName: "Garant" }).title, "Radist · Garant");
});

test("ограничения длины", () => {
  const p = { ...emptyPayload("other"), service_name: "S", login: "l", password: "x".repeat(501) };
  assert.ok(validatePayload(p).password);
});
