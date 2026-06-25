// Клиент Open Banking API Точки (только сервер). Документация:
// https://developers.tochka.com/docs/tochka-api/
// Формат ответов — стандарт OpenBanking ЦБ РФ ({ Data: { ... } }).
//
// Авторизация: JWT-токен → заголовок `Authorization: Bearer <token>`.
// Базовый URL и версия настраиваются через env (значения по умолчанию — прод).

const BASE_URL = (process.env.TOCHKA_API_BASE || "https://enter.tochka.com/uapi").replace(/\/$/, "");

export type TochkaAccount = {
  accountId: string;
  accountNumber: string | null;
  currency: string;
  name: string | null;
};

export type TochkaOperation = {
  transactionId: string;
  direction: "income" | "expense";
  amountMinor: number;
  currency: string;
  date: string; // YYYY-MM-DD
  counterpartyName: string | null;
  counterpartyAccount: string | null;
  counterpartyInn: string | null;
  description: string | null;
};

type FetchOpts = { token: string; apiVersion: string };

async function api<T>(path: string, { token, method = "GET", body }: { token: string; method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${BASE_URL}/${path.replace(/^\//, "")}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Точка API ${res.status}: ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function toMinor(amount: string | number): number {
  const n = typeof amount === "number" ? amount : parseFloat(String(amount).replace(",", "."));
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}

function dateOnly(iso: string | null | undefined): string {
  if (!iso) return new Date().toISOString().slice(0, 10);
  return String(iso).slice(0, 10);
}

// ── Счета ───────────────────────────────────────────────────────────────────
export async function getAccounts({ token, apiVersion }: FetchOpts): Promise<TochkaAccount[]> {
  const json = await api<{ Data?: { Account?: RawAccount[] } }>(`open-banking/${apiVersion}/accounts`, { token });
  const list = json.Data?.Account ?? [];
  return list.map((a) => ({
    accountId: a.accountId,
    accountNumber: a.accountId?.split("/")?.[0] ?? a.accountId ?? null,
    currency: a.currency ?? "RUB",
    name: a.accountType ?? null,
  }));
}

type RawAccount = { accountId: string; currency?: string; accountType?: string };

// Сырой ответ по счетам — для диагностики маппинга на живом токене.
export async function getAccountsRaw({ token, apiVersion }: FetchOpts): Promise<unknown> {
  return api(`open-banking/${apiVersion}/accounts`, { token });
}


// ── Выписка (асинхронно): init → poll → get операции ──────────────────────────
export async function fetchOperations(
  opts: FetchOpts & { accountId: string; from: string; to: string },
): Promise<TochkaOperation[]> {
  const { token, apiVersion, accountId, from, to } = opts;

  // Тело init-запроса: имена полей периода у разных версий API отличаются —
  // пробуем стандартный вариант OpenBanking, при ошибке валидации повторяем альтернативой.
  const candidates = [
    { Data: { Statement: { accountId, startDateTime: from, endDateTime: to } } },
    { Data: { Statement: { accountId, fromBookingDateTime: from, toBookingDateTime: to } } },
  ];
  let statementId: string | undefined;
  let lastErr: unknown;
  for (const body of candidates) {
    try {
      const init = await api<{ Data?: { Statement?: RawIdHolder | RawIdHolder[] } }>(
        `open-banking/${apiVersion}/statements`,
        { token, method: "POST", body },
      );
      const st = init.Data?.Statement;
      statementId = Array.isArray(st) ? st[0]?.statementId : st?.statementId;
      if (statementId) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!statementId) throw (lastErr instanceof Error ? lastErr : new Error("Точка не вернула statementId"));

  // Поллинг статуса до Ready (до ~20 сек).
  let statement: RawStatement | null = null;
  for (let i = 0; i < 10; i++) {
    const got = await api<{ Data?: { Statement?: RawStatement | RawStatement[] } }>(
      `open-banking/${apiVersion}/accounts/${encodeURIComponent(accountId)}/statements/${encodeURIComponent(statementId)}`,
      { token },
    );
    const st = got.Data?.Statement;
    statement = Array.isArray(st) ? st[0] ?? null : st ?? null;
    const status = statement?.status;
    if (status === "Ready" || (statement?.Transaction?.length ?? 0) > 0) break;
    if (status === "Error") throw new Error("Точка: ошибка формирования выписки");
    await new Promise((r) => setTimeout(r, 2000));
  }

  const txs = statement?.Transaction ?? [];
  return txs.map(mapOperation);
}

type RawIdHolder = { statementId?: string };

type RawParty = { name?: string; inn?: string } | null;
type RawAcc = { accountNumber?: string; identification?: string } | null;
type RawTransaction = {
  transactionId?: string;
  documentId?: string;
  creditDebitIndicator?: string; // "Credit" | "Debit"
  Amount?: { amount?: string | number; currency?: string };
  bookingDateTime?: string;
  valueDateTime?: string;
  description?: string;
  paymentPurpose?: string;
  DebtorParty?: RawParty;
  CreditorParty?: RawParty;
  DebtorAccount?: RawAcc;
  CreditorAccount?: RawAcc;
};
type RawStatement = { status?: string; Transaction?: RawTransaction[] };

function mapOperation(t: RawTransaction): TochkaOperation {
  const isCredit = (t.creditDebitIndicator ?? "").toLowerCase().startsWith("credit");
  // При зачислении контрагент — плательщик (Debtor), при списании — получатель (Creditor).
  const party = isCredit ? t.DebtorParty : t.CreditorParty;
  const acc = isCredit ? t.DebtorAccount : t.CreditorAccount;
  return {
    transactionId: t.transactionId || t.documentId || `${t.bookingDateTime ?? ""}-${t.Amount?.amount ?? ""}-${acc?.accountNumber ?? ""}`,
    direction: isCredit ? "income" : "expense",
    amountMinor: toMinor(t.Amount?.amount ?? 0),
    currency: t.Amount?.currency ?? "RUB",
    date: dateOnly(t.bookingDateTime || t.valueDateTime),
    counterpartyName: party?.name ?? null,
    counterpartyAccount: acc?.accountNumber ?? acc?.identification ?? null,
    counterpartyInn: party?.inn ?? null,
    description: t.paymentPurpose || t.description || null,
  };
}
