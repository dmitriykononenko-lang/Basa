// Шифрование «Запросить доступ у клиента». Чистый WebCrypto — одинаково работает
// в браузере и в Node (тесты). Сервер этот модуль не использует для расшифровки:
// закрытый ключ команды существует в открытом виде только в браузере владельца.
//
// Схема:
//  • Ключ команды — ECDH P-256. Открытый ключ (raw, base64url) лежит в БД открыто.
//  • Закрытый ключ (pkcs8) шифруется AES-256-GCM ключом из пароля владельца
//    (PBKDF2-SHA256, 600 000 итераций, соль 16 байт) и хранится в БД только так.
//  • Клиент: эфемерная пара ECDH → общий секрет с ключом команды → HKDF-SHA256 →
//    AES-256-GCM. AAD = "ko-intake:v1:<request_id>" — шифртекст нельзя подсунуть
//    в другой запрос.

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 12;

export type WrappedPrivateKey = {
  v: 1;
  kdf: "PBKDF2";
  hash: "SHA-256";
  iter: number;
  salt: string;
  iv: string;
  ct: string;
};

export type SealedPayload = {
  v: 1;
  kid: string;
  epk: string;
  iv: string;
  ct: string;
};

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("Браузер не поддерживает WebCrypto — откройте ссылку в актуальном браузере.");
  return c.subtle;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64u(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("Повреждённые данные.");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  globalThis.crypto.getRandomValues(out);
  return out;
}

const EC = { name: "ECDH", namedCurve: "P-256" } as const;

async function passphraseKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", enc.encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iter },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// Новый ключ команды: пара создаётся здесь, закрытый ключ сразу шифруется паролем.
export async function generateTeamKey(
  passphrase: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ publicKey: string; wrapped: WrappedPrivateKey }> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Пароль ключа — не короче ${MIN_PASSPHRASE_LENGTH} символов.`);
  }
  const pair = (await subtle().generateKey(EC, true, ["deriveBits"])) as CryptoKeyPair;
  const rawPub = await subtle().exportKey("raw", pair.publicKey);
  const pkcs8 = await subtle().exportKey("pkcs8", pair.privateKey);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const wrapKey = await passphraseKey(passphrase, salt, iterations);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, wrapKey, pkcs8);
  return {
    publicKey: toB64u(rawPub),
    wrapped: { v: 1, kdf: "PBKDF2", hash: "SHA-256", iter: iterations, salt: toB64u(salt), iv: toB64u(iv), ct: toB64u(ct) },
  };
}

// Разблокировать закрытый ключ паролем. Неверный пароль → понятная ошибка.
export async function unlockTeamKey(wrapped: WrappedPrivateKey, passphrase: string): Promise<CryptoKey> {
  if (!wrapped || wrapped.v !== 1) throw new Error("Неизвестный формат ключа.");
  const wrapKey = await passphraseKey(passphrase, fromB64u(wrapped.salt), wrapped.iter);
  let pkcs8: ArrayBuffer;
  try {
    pkcs8 = await subtle().decrypt({ name: "AES-GCM", iv: fromB64u(wrapped.iv) }, wrapKey, fromB64u(wrapped.ct));
  } catch {
    throw new Error("Неверный пароль ключа.");
  }
  // extractable=false: из памяти страницы ключ не выгрузить даже скриптом.
  return subtle().importKey("pkcs8", pkcs8, EC, false, ["deriveBits"]);
}

async function aesFromShared(priv: CryptoKey, pub: CryptoKey, salt: Uint8Array<ArrayBuffer>, info: string): Promise<CryptoKey> {
  const bits = await subtle().deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const hk = await subtle().importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: enc.encode(info) },
    hk,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const aad = (requestId: string) => enc.encode(`ko-intake:v1:${requestId}`);

// Клиент: зашифровать данные открытым ключом команды.
export async function sealForTeam(
  teamPublicKey: string,
  keyId: string,
  requestId: string,
  data: unknown,
): Promise<string> {
  const pub = await subtle().importKey("raw", fromB64u(teamPublicKey), EC, false, []);
  const eph = (await subtle().generateKey(EC, true, ["deriveBits"])) as CryptoKeyPair;
  const epkRaw = new Uint8Array(await subtle().exportKey("raw", eph.publicKey));
  // соль HKDF = эфемерный открытый ключ: каждый шифртекст — свой AES-ключ
  const key = await aesFromShared(eph.privateKey, pub, epkRaw, `ko-intake:v1:${keyId}`);
  const iv = randomBytes(12);
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: aad(requestId) },
    key,
    enc.encode(JSON.stringify(data)),
  );
  const sealed: SealedPayload = { v: 1, kid: keyId, epk: toB64u(epkRaw), iv: toB64u(iv), ct: toB64u(ct) };
  return JSON.stringify(sealed);
}

// Владелец: расшифровать отправленные клиентом данные разблокированным ключом.
export async function openSealed<T = unknown>(privateKey: CryptoKey, requestId: string, sealedJson: string): Promise<T> {
  let sealed: SealedPayload;
  try {
    sealed = JSON.parse(sealedJson) as SealedPayload;
  } catch {
    throw new Error("Повреждённый шифртекст.");
  }
  if (sealed?.v !== 1) throw new Error("Неизвестный формат шифртекста.");
  const epkRaw = fromB64u(sealed.epk);
  const epk = await subtle().importKey("raw", epkRaw, EC, false, []);
  const key = await aesFromShared(privateKey, epk, epkRaw, `ko-intake:v1:${sealed.kid}`);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt(
      { name: "AES-GCM", iv: fromB64u(sealed.iv), additionalData: aad(requestId) },
      key,
      fromB64u(sealed.ct),
    );
  } catch {
    throw new Error("Не удалось расшифровать: другой ключ команды или данные повреждены.");
  }
  return JSON.parse(dec.decode(plain)) as T;
}
