// Чистые помощники разбора банковской выписки (без React/Supabase).
// Кодировки (UTF-8/CP1251), CSV, даты, автоподбор колонок, пресеты банков.

export type FieldKey =
  | "date" | "amount" | "amountIn" | "amountOut" | "currency"
  | "account" | "category" | "counterparty" | "project" | "note" | "typeCol";

export type Mapping = Record<FieldKey, number>; // индекс колонки или -1
export type TypeMode = "sign" | "split" | "column";
export const NONE = -1;

// ── Кодировка: банковские выписки часто в Windows-1251 ──
export function decodeBuffer(buf: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("windows-1251").decode(buf);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  return text;
}

export function detectDelimiter(headerLine: string): string {
  const counts: [string, number][] = [
    [";", (headerLine.match(/;/g) ?? []).length],
    ["\t", (headerLine.match(/\t/g) ?? []).length],
    [",", (headerLine.match(/,/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

// CSV-строка с учётом кавычек
export function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Даты: ISO, dd.mm.yyyy, dd/mm/yyyy, dd.mm.yy, yyyy.mm.dd
export function parseDate(s: string): string | null {
  s = (s ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ymd = s.match(/^(\d{4})[.\/](\d{2})[.\/](\d{2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const dmy = s.match(/^(\d{2})[.\/](\d{2})[.\/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const dmy2 = s.match(/^(\d{2})[.\/](\d{2})[.\/](\d{2})\b/);
  if (dmy2) return `20${dmy2[3]}-${dmy2[2]}-${dmy2[1]}`;
  return null;
}

// Тип операции по тексту колонки
export function classifyType(raw: string): "income" | "expense" | null {
  const s = (raw ?? "").toLowerCase();
  if (/дох|income|credit|кредит|приход|поступл|пополн|зачислен|\+/.test(s)) return "income";
  if (/рас|expense|debit|дебет|списан|выплат|оплат|снятие|-/.test(s)) return "expense";
  return null;
}

// ── Автоподбор колонок по заголовку ──
export function autoMap(header: string[]): { map: Mapping; mode: TypeMode } {
  const h = header.map((x) => x.toLowerCase());
  const find = (...keys: string[]) => h.findIndex((x) => keys.some((k) => x.includes(k)));
  const map: Mapping = {
    date: find("дата операции", "дата проводки", "дата", "date"),
    amount: find("сумма операции", "сумма платежа", "сумма", "amount"),
    amountIn: find("приход", "поступлен", "кредит", "credit", "зачислен"),
    amountOut: find("расход", "списан", "дебет", "debit", "выплат", "снятие"),
    currency: find("валюта", "currency"),
    account: find("счёт", "счет", "account", "номер карты", "карт"),
    category: find("категори", "статья", "category"),
    counterparty: find("контрагент", "получател", "плательщик", "корреспондент"),
    project: find("проект", "project"),
    note: find("назначение платеж", "коммент", "описан", "note", "purpose", "назначение"),
    typeCol: find("тип операции", "тип", "type", "дебет/кредит"),
  };
  let mode: TypeMode = "sign";
  if (map.amountIn >= 0 && map.amountOut >= 0) mode = "split";
  else if (map.typeCol >= 0 && map.typeCol !== map.amount) mode = "column";
  return { map, mode };
}

// ── Пресеты банков: определяем по сигнатуре заголовка ──
export type BankPreset = {
  id: string;
  label: string;
  signature: (h: string[]) => boolean;
  typeMode?: TypeMode;
};

export const BANK_PRESETS: BankPreset[] = [
  {
    id: "tinkoff",
    label: "Тинькофф",
    signature: (h) => h.some((x) => x.includes("дата операции")) && h.some((x) => x.includes("сумма операции")),
    typeMode: "sign",
  },
  {
    id: "sber",
    label: "Сбербанк",
    signature: (h) => h.some((x) => x.includes("дата операции")) && h.some((x) => x.includes("сумма в валюте счёта") || x.includes("сумма в валюте счета")),
    typeMode: "sign",
  },
  {
    id: "alfa",
    label: "Альфа-Банк",
    signature: (h) => h.some((x) => x.includes("приход")) && h.some((x) => x.includes("расход")) && h.some((x) => x.includes("дата")),
    typeMode: "split",
  },
  {
    id: "1c",
    label: "1С / клиент-банк",
    signature: (h) => h.some((x) => x.includes("номер документа")) && h.some((x) => x.includes("назначение платеж")),
    typeMode: "split",
  },
];

export function detectBank(header: string[]): BankPreset | null {
  const h = header.map((x) => x.toLowerCase());
  return BANK_PRESETS.find((p) => p.signature(h)) ?? null;
}

// Ключ для дедупликации/сопоставления переводов
export function txKey(accountId: string, occurredOn: string, amount: number, type: string): string {
  return `${accountId}|${occurredOn}|${amount}|${type}`;
}
