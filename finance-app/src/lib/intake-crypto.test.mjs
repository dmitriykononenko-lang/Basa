// Тесты шифрования «Запросить доступ у клиента». Запуск: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateTeamKey, unlockTeamKey, sealForTeam, openSealed, toB64u, fromB64u } from "./intake-crypto.ts";

const PASS = "очень-длинный пароль 42";
const ITER = 1000; // в тестах быстрее; в продукте 600 000
const KID = "3f0f7a52-6a8e-4d5e-9d6b-1f1e2a3b4c5d";
const REQ = "9a1b2c3d-0000-4000-8000-000000000001";

test("base64url туда-обратно", () => {
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(Array.from(fromB64u(toB64u(bytes))), Array.from(bytes));
  assert.throws(() => fromB64u("a+b/"), /Повреждённые/);
});

test("ключ команды: короткий пароль отклоняется", async () => {
  await assert.rejects(() => generateTeamKey("short", ITER), /не короче/);
});

test("полный цикл: клиент шифрует, владелец расшифровывает", async () => {
  const { publicKey, wrapped } = await generateTeamKey(PASS, ITER);
  assert.match(publicKey, /^[A-Za-z0-9_-]{87}$/); // 65 байт raw P-256
  assert.equal(wrapped.v, 1);
  assert.equal(JSON.stringify(wrapped).includes(PASS), false);

  const data = { login: "owner@client.ru", password: "S3cr3t!", twofa_where: "SMS на +7…12" };
  const sealed = await sealForTeam(publicKey, KID, REQ, data);
  assert.equal(sealed.includes("S3cr3t"), false);
  assert.equal(sealed.includes("owner@client.ru"), false);
  const parsed = JSON.parse(sealed);
  assert.equal(parsed.v, 1);
  assert.equal(parsed.kid, KID);

  const priv = await unlockTeamKey(wrapped, PASS);
  assert.equal(priv.extractable, false);
  assert.deepEqual(await openSealed(priv, REQ, sealed), data);
});

test("неверный пароль ключа", async () => {
  const { wrapped } = await generateTeamKey(PASS, ITER);
  await assert.rejects(() => unlockTeamKey(wrapped, PASS + "x"), /Неверный пароль ключа/);
});

test("шифртекст привязан к запросу: другой request_id не расшифровывается", async () => {
  const { publicKey, wrapped } = await generateTeamKey(PASS, ITER);
  const sealed = await sealForTeam(publicKey, KID, REQ, { a: 1 });
  const priv = await unlockTeamKey(wrapped, PASS);
  await assert.rejects(() => openSealed(priv, REQ.replace(/1$/, "2"), sealed), /Не удалось расшифровать/);
});

test("подмена шифртекста или чужой ключ — ошибка", async () => {
  const a = await generateTeamKey(PASS, ITER);
  const b = await generateTeamKey(PASS, ITER);
  const sealed = await sealForTeam(a.publicKey, KID, REQ, { a: 1 });
  const privB = await unlockTeamKey(b.wrapped, PASS);
  await assert.rejects(() => openSealed(privB, REQ, sealed), /Не удалось расшифровать/);

  const privA = await unlockTeamKey(a.wrapped, PASS);
  const s = JSON.parse(sealed);
  const ct = fromB64u(s.ct); ct[0] ^= 1;
  await assert.rejects(() => openSealed(privA, REQ, JSON.stringify({ ...s, ct: toB64u(ct) })), /Не удалось расшифровать/);
  await assert.rejects(() => openSealed(privA, REQ, JSON.stringify({ ...s, kid: "другой" })), /Не удалось расшифровать/);
});

test("каждое шифрование уникально (эфемерный ключ и iv)", async () => {
  const { publicKey } = await generateTeamKey(PASS, ITER);
  const x = JSON.parse(await sealForTeam(publicKey, KID, REQ, { a: 1 }));
  const y = JSON.parse(await sealForTeam(publicKey, KID, REQ, { a: 1 }));
  assert.notEqual(x.epk, y.epk);
  assert.notEqual(x.ct, y.ct);
});
