// Telegram Mini App: проверка initData и хелперы. Только серверный код.
//
// initData — это query-строка, подписанная Telegram по токену бота. Алгоритм
// проверки (официальный): secret = HMAC_SHA256(key="WebAppData", msg=bot_token);
// затем HMAC_SHA256(key=secret, msg=data_check_string) сравниваем с hash.
// data_check_string — все пары "ключ=значение" (кроме hash), отсортированные по
// ключу и склеенные через \n.

import crypto from "crypto";

export type TgUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

export function botToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN;
}

export function botConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export type InitDataResult =
  | { ok: true; user: TgUser; authDate: number }
  | { ok: false; error: string };

// Проверяет подпись initData и возвращает пользователя Telegram.
// maxAgeSec — допустимый возраст подписи (по умолчанию 24 ч).
export function validateInitData(initData: string, maxAgeSec = 86400): InitDataResult {
  const token = botToken();
  if (!token) return { ok: false, error: "bot_not_configured" };
  if (!initData) return { ok: false, error: "no_init_data" };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, error: "bad_init_data" };
  }

  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "no_hash" };

  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key === "hash") return;
    pairs.push(`${key}=${value}`);
  });
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const computed = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  // Сравнение в постоянном времени.
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "bad_signature" };
  }

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) {
    return { ok: false, error: "expired" };
  }

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, error: "no_user" };
  let user: TgUser;
  try {
    user = JSON.parse(userRaw) as TgUser;
  } catch {
    return { ok: false, error: "bad_user" };
  }
  if (!user || typeof user.id !== "number") return { ok: false, error: "bad_user" };

  return { ok: true, user, authDate };
}

// Имя для показа: «Имя Фамилия» либо @username.
export function tgDisplayName(u: TgUser): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return name || (u.username ? `@${u.username}` : `id${u.id}`);
}

// Хеш одноразового кода привязки (для хранения/сравнения).
export function hashLinkCode(code: string): string {
  return crypto.createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

// Генерация одноразового кода привязки: 6 символов без неоднозначных (0/O, 1/I).
export function generateLinkCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
