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
  counterpartyKpp: string | null;
  description: string | null;
  docNumber: string | null;   // номер платёжного документа
  docType: string | null;     // тип документа (напр. «Платежное поручение»)
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

// ── Счета на оплату (invoice-API) ─────────────────────────────────────────────
// ВНИМАНИЕ: точные имена вложенных полей (SecondSide/Content/Position) подтверждены
// лишь частично по докам; финализируются по первому живому ответу Точки (см. issue
// route c ?debug=1). Версия сервиса invoice — фиксированная "v1.0".
const INVOICE_VERSION = "v1.0";

export type TochkaVat = "none" | "0" | "10" | "20";
export type TochkaInvoicePayload = {
  accountId: string;        // счёт Точки (формат "<номер>/<БИК>")
  customerCode: string;     // код клиента в Точке
  purpose: string;          // назначение платежа
  paymentExpiryDate?: string | null; // YYYY-MM-DD
  buyer: { name: string; inn: string; kpp?: string | null; taxSystemCode?: number | null };
  items: { name: string; quantity: number; unitPriceMinor: number; vat: TochkaVat; unit?: string }[];
};

function money2(minor: number): number { return Math.round(minor) / 100; }
function vatToTochka(v: TochkaVat): string {
  // Ориентировочный маппинг ставок НДС Точки — уточнить по живому ответу.
  return v === "none" ? "without" : `nds${v}`;
}

// Сборка тела Create Invoice. Вынесена отдельно, чтобы легко править имена полей.
export function buildBillBody(p: TochkaInvoicePayload): unknown {
  const Position = p.items.map((it) => ({
    positionName: it.name,
    unitCode: it.unit || "шт",
    quantity: it.quantity,
    price: money2(it.unitPriceMinor),
    vatType: vatToTochka(it.vat),
    amount: money2(Math.round(it.quantity * it.unitPriceMinor)),
  }));
  return {
    Data: {
      customerCode: p.customerCode,
      accountId: p.accountId,
      paymentExpiryDate: p.paymentExpiryDate || undefined,
      SecondSide: {
        inn: p.buyer.inn || undefined,
        legalName: p.buyer.name || undefined,
        kpp: p.buyer.kpp || undefined,
        taxSystemCode: p.buyer.taxSystemCode ?? undefined,
      },
      Content: {
        purpose: p.purpose || undefined,
        Position,
      },
    },
  };
}

// Создать счёт на оплату. Возвращает documentId и сырой ответ.
export async function createInvoice({ token }: { token: string }, p: TochkaInvoicePayload): Promise<{ documentId: string | null; raw: unknown }> {
  const json = await api<{ Data?: { documentId?: string; Bill?: { documentId?: string } } }>(
    `invoice/${INVOICE_VERSION}/bills`,
    { token, method: "POST", body: buildBillBody(p) },
  );
  const documentId = json.Data?.documentId ?? json.Data?.Bill?.documentId ?? null;
  return { documentId, raw: json };
}

// Статус оплаты счёта.
export async function getInvoicePaymentStatus({ token }: { token: string }, customerCode: string, documentId: string): Promise<{ status: string; raw: unknown }> {
  const json = await api<{ Data?: { paymentStatus?: string; status?: string } }>(
    `invoice/${INVOICE_VERSION}/bills/${encodeURIComponent(customerCode)}/${encodeURIComponent(documentId)}/payment_status`,
    { token },
  );
  const status = json.Data?.paymentStatus ?? json.Data?.status ?? "";
  return { status, raw: json };
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


// ── Выписка (асинхронно): init → poll → Get Statement ─────────────────────────
async function getStatement(
  opts: FetchOpts & { accountId: string; from: string; to: string },
): Promise<RawStatement | null> {
  const { token, apiVersion, accountId, from, to } = opts;

  // Поля подтверждены ТП Точки: accountId (счёт/БИК), startDateTime, endDateTime.
  // Основной вариант — обёртка Data.Statement (стандарт OpenBanking); запасной —
  // плоское тело с теми же полями, на случай если шлюз не требует обёртку.
  const candidates = [
    { Data: { Statement: { accountId, startDateTime: from, endDateTime: to } } },
    { accountId, startDateTime: from, endDateTime: to },
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

  // Поллинг статуса до Ready (до ~60 сек — большие выписки Точка собирает дольше).
  // ВАЖНО: нельзя принимать выписку, как только в ней появились операции — для крупных
  // счетов Точка отдаёт список постепенно, и ранний выход обрезает её (приходит лишь часть
  // дохода). Ждём именно status === "Ready". Если шлюз статус не присылает — ждём, пока число
  // операций не стабилизируется (два одинаковых замера подряд = сборка завершена).
  let statement: RawStatement | null = null;
  let lastCount = -1;
  let stableHits = 0;
  let sawStatus = false;
  const MAX_POLLS = 30;
  for (let i = 0; i < MAX_POLLS; i++) {
    const got = await api<{ Data?: { Statement?: RawStatement | RawStatement[] } }>(
      `open-banking/${apiVersion}/accounts/${encodeURIComponent(accountId)}/statements/${encodeURIComponent(statementId)}`,
      { token },
    );
    const st = got.Data?.Statement;
    statement = Array.isArray(st) ? st[0] ?? null : st ?? null;
    const status = statement?.status;
    if (status) sawStatus = true;
    if (status === "Error") throw new Error("Точка: ошибка формирования выписки");
    if (status === "Ready") break;
    if (!sawStatus) {
      // Шлюз без поля статуса: ждём стабилизации количества операций.
      const count = statement?.Transaction?.length ?? 0;
      if (count > 0 && count === lastCount) {
        if (++stableHits >= 2) break;
      } else {
        stableHits = 0;
      }
      lastCount = count;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  // Если статус приходил, но Ready так и не дождались — это тайм-аут, а не пустая выписка.
  // Бросаем ошибку, чтобы импорт сообщил о проблеме, а не сохранил неполные данные молча.
  if (sawStatus && statement?.status !== "Ready") {
    throw new Error("Точка: выписка ещё формируется (тайм-аут). Повторите импорт этого счёта.");
  }
  return statement;
}

export async function fetchOperations(
  opts: FetchOpts & { accountId: string; from: string; to: string },
): Promise<TochkaOperation[]> {
  const statement = await getStatement(opts);
  return (statement?.Transaction ?? []).map(mapOperation);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

// Точка обрезает выписку нагруженного счёта последним окном дат (для крупного счёта
// за 2.5 года возвращается лишь последний месяц). Грузим адаптивно «шагая назад»:
// получили выписку → если её самая ранняя операция не достаёт до начала запрошенного
// диапазона, значит выписка обрезана — догружаем ещё более ранний кусок [from, earliest-1]
// и так далее, пока не упрёмся в from или в пустой ответ. Маленькие счета берутся за 1 запрос.
export async function fetchOperationsWindowed(
  opts: FetchOpts & { accountId: string; from: string; to: string },
  depth = 0,
): Promise<TochkaOperation[]> {
  const MAX_WINDOWS = 60; // потолок шагов (≈5 лет помесячно) — защита от бесконечного цикла
  const ops = await fetchOperations(opts);
  if (ops.length === 0 || depth >= MAX_WINDOWS) return ops;

  const earliest = ops.reduce((m, o) => (o.date < m ? o.date : m), ops[0].date);
  // Выписка не достала до начала диапазона (> 5 дней зазор) → вероятно обрезана.
  if (daysBetween(opts.from, earliest) > 5) {
    const earlier = await fetchOperationsWindowed(
      { ...opts, to: addDays(earliest, -1) }, // строго раньше уже полученного — прогресс гарантирован
      depth + 1,
    );
    const byId = new Map<string, TochkaOperation>();
    for (const o of [...earlier, ...ops]) byId.set(o.transactionId, o);
    return [...byId.values()];
  }
  return ops;
}

// Сырые операции из выписки — для сверки имён полей на живом API.
export async function fetchStatementRaw(
  opts: FetchOpts & { accountId: string; from: string; to: string },
): Promise<unknown> {
  const statement = await getStatement(opts);
  return (statement?.Transaction ?? []).slice(0, 3);
}

type RawIdHolder = { statementId?: string };

type RawParty = { name?: string; inn?: string; kpp?: string } | null;
type RawAcc = { accountNumber?: string; identification?: string } | null;
type RawTransaction = {
  transactionId?: string;
  documentId?: string;
  documentNumber?: string;
  transactionTypeCode?: string;
  documentProcessDate?: string;
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

// Имя поля даты у Точки заранее неизвестно — сканируем все строковые поля,
// в имени которых есть "date", и берём приоритетное (booking/transaction/...).
// Понимаем оба формата: ISO (2026-04-27) и ДД.ММ.ГГГГ (27.04.2026).
function pickDate(t: Record<string, unknown>): string | null {
  const entries = Object.entries(t).filter(
    ([k, v]) => typeof v === "string" && /date/i.test(k),
  ) as [string, string][];
  const score = (k: string) => {
    const s = k.toLowerCase();
    if (s.includes("booking")) return 6;
    if (s.includes("transaction")) return 5;
    if (s.includes("operation")) return 5;
    if (s.includes("value")) return 4;
    if (s.includes("process")) return 4; // documentProcessDate у Точки
    if (s.includes("execut")) return 3;
    if (s.includes("document")) return 2;
    return 1;
  };
  entries.sort((a, b) => score(b[0]) - score(a[0]));
  for (const [, v] of entries) {
    const iso = v.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = v.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  }
  return null;
}

function mapOperation(t: RawTransaction): TochkaOperation {
  const isCredit = (t.creditDebitIndicator ?? "").toLowerCase().startsWith("credit");
  // При зачислении контрагент — плательщик (Debtor), при списании — получатель (Creditor).
  const party = isCredit ? t.DebtorParty : t.CreditorParty;
  const acc = isCredit ? t.DebtorAccount : t.CreditorAccount;
  const kpp = party?.kpp && party.kpp !== "0" ? party.kpp : null;
  return {
    transactionId: t.transactionId || t.documentId || `${pickDate(t) ?? ""}-${t.Amount?.amount ?? ""}-${acc?.accountNumber ?? acc?.identification ?? ""}`,
    direction: isCredit ? "income" : "expense",
    amountMinor: toMinor(t.Amount?.amount ?? 0),
    currency: t.Amount?.currency ?? "RUB",
    date: pickDate(t as Record<string, unknown>) ?? dateOnly(null),
    counterpartyName: party?.name ?? null,
    counterpartyAccount: acc?.accountNumber ?? acc?.identification ?? null,
    counterpartyInn: party?.inn ?? null,
    counterpartyKpp: kpp,
    description: t.paymentPurpose || t.description || null,
    docNumber: t.documentNumber ?? null,
    docType: t.transactionTypeCode ?? null,
  };
}
