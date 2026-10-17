import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM шифрование секретов (банковский токен) для хранения в БД.
// Ключ — переменная окружения TOCHKA_TOKEN_KEY: 32 байта в hex (64 символа)
// или base64. Никогда не уходит в браузер — модуль только серверный.

function getKey(): Buffer {
  const raw = process.env.TOCHKA_TOKEN_KEY;
  if (!raw) {
    throw new Error(
      "TOCHKA_TOKEN_KEY не задан. Сгенерируйте ключ: `openssl rand -hex 32` и добавьте в переменные окружения."
    );
  }
  // Убираем любые пробелы/переносы/кавычки, которые могли попасть при вставке.
  const cleaned = raw.trim().replace(/\s+/g, "").replace(/^["']|["']$/g, "");
  const buf = /^[0-9a-fA-F]{64}$/.test(cleaned) ? Buffer.from(cleaned, "hex") : Buffer.from(cleaned, "base64");
  if (buf.length !== 32) {
    throw new Error(`TOCHKA_TOKEN_KEY должен быть 32 байта (hex 64 симв. или base64). Сейчас распознано ${buf.length} байт из строки длиной ${cleaned.length}.`);
  }
  return buf;
}

export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${data.toString("base64")}`;
}

export function decryptSecret(cipherText: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = cipherText.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Повреждённый шифртекст токена.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

// Маскируем токен для показа в UI: первые/последние символы.
export function maskToken(token: string): string {
  if (token.length <= 12) return "••••";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}
