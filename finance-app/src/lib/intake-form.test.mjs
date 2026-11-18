// Тесты формы клиента и черновика записи. Запуск: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPayload, emptyExtra, validatePayload, cleanPayload, draftEntry, draftExtras, receiptLines, isUserAddService, MAX_EXTRAS } from "./intake-form.ts";

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

test("доп. доступы клиента: проверка, очистка, черновики, квитанция без паролей", () => {
  const base = { ...emptyPayload("amocrm"), account: "m.amocrm.ru", user_added: true };
  const bad = { ...base, extras: [{ ...emptyExtra(), twofa_method: "sms" }] };
  const e = validatePayload(bad);
  assert.ok(e["extras.0.service_name"] && e["extras.0.login"] && e["extras.0.password"] && e["extras.0.twofa_where"]);

  const ok = { ...base, extras: [
    { ...emptyExtra(), service_name: " Tilda ", url: "https://tilda.cc", login: "site@m.test", password: "p1" },
    { ...emptyExtra(), service_name: "Хостинг", login: "root", password: "p2", twofa_method: "app" },
  ] };
  assert.deepEqual(validatePayload(ok), {});
  const c = cleanPayload(ok);
  assert.equal(c.extras[0].service_name, "Tilda");
  const d = draftExtras(c, { clientName: "Maison" });
  assert.equal(d.length, 2);
  assert.equal(d[0].title, "Tilda · Maison");
  assert.equal(d[1].secret, "p2");
  assert.match(d[0].note, /добавил этот доступ сам/);

  const r = receiptLines(c);
  assert.equal(r.length, 3);
  assert.equal(JSON.stringify(r).includes("p1") || JSON.stringify(r).includes("site@m.test"), false);
  assert.match(r[0].detail, /пароль не передавался/);

  const many = { ...ok, extras: Array.from({ length: MAX_EXTRAS + 1 }, () => ok.extras[0]) };
  assert.ok(validatePayload(many).extras);
  assert.equal(cleanPayload(many).extras.length, MAX_EXTRAS);
});
