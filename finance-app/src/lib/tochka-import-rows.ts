import type { TochkaOperation } from "./tochka";

// Чистая часть импорта Точки: операции выписки → строки для bank_import_commit.
// Вынесена из tochka-import.ts без зависимостей от Supabase, чтобы её можно было
// проверить тестами (tochka-import-rows.test.mjs).
//
// Каноническое представление перевода между своими счетами — ОДНА строка
// type='transfer': account_id — счёт списания, transfer_account_id — счёт
// зачисления. Вью баланса вычитает сумму у account_id и прибавляет у
// transfer_account_id, поэтому направление обязано соответствовать банку.

export type TochkaImportRow = {
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  account_id: string | null;
  transfer_account_id: string | null;
  category_id: string | null;
  counterparty_key: string | null;
  occurred_on: string;
  note: string | null;
  external_id: string;
  provider: "tochka";
  origin: "bank";
};

export type TochkaCounterparty = { key: string; name: string; inn: string | null; kpp: string | null; kind: string };

export type BuildRowsParams = {
  // Счета, выписки которых импортируются из Точки (список getAccounts). Перевод
  // с такого счёта приходит и его собственной выпиской — там он и учитывается
  // исходящей ногой, входящая здесь пропускается.
  statementNumbers: Set<string>;
  // Все свои счета, известные Basa: номер → id счёта (bank_account_links +
  // accounts.number, см. loadOwnAccountMap). Сюда попадают и архивные счета,
  // которых уже нет в getAccounts.
  ownAccounts: Map<string, string>;
  targetAccountId: string | null;
  defaultIncomeCat: string | null;
  defaultExpenseCat: string | null;
};

// Назначения платежа, которыми банк помечает движение между своими счетами
// клиента: «Перевод собственных средств», «Отчисление в фонд Резерв» (фонды Точки).
const OWN_FUNDS_RE = /перевод\s+собственных\s+средств|отчислени[ея]\s+в\s+фонд/i;

export function normalizeAccountNumber(n: string | null | undefined): string | null {
  const digits = (n ?? "").replace(/\D/g, "");
  return digits || null;
}

export function counterpartyKey(o: TochkaOperation): string | null {
  const inn = o.counterpartyInn?.trim();
  const name = o.counterpartyName?.trim();
  if (inn) return `inn:${inn}`;
  if (name) return `name:${name.toLowerCase()}`;
  return null;
}

export function buildTochkaRows(
  ops: TochkaOperation[],
  p: BuildRowsParams,
): { rows: TochkaImportRow[]; counterparties: TochkaCounterparty[]; transfers: number } {
  const { targetAccountId, defaultIncomeCat, defaultExpenseCat } = p;
  const statementNumbers = new Set([...p.statementNumbers].map(normalizeAccountNumber).filter((n): n is string => !!n));
  const ownAccounts = new Map<string, string>();
  for (const [num, id] of p.ownAccounts) {
    const n = normalizeAccountNumber(num);
    if (n && id) ownAccounts.set(n, id);
  }

  const cpAcc = (o: TochkaOperation) => normalizeAccountNumber(o.counterpartyAccount);
  const isOwnAccount = (o: TochkaOperation) => {
    const n = cpAcc(o);
    return !!n && (statementNumbers.has(n) || ownAccounts.has(n));
  };
  const isTransfer = (o: TochkaOperation) => isOwnAccount(o) || OWN_FUNDS_RE.test(o.description ?? "");
  // Входящая нога перевода со счёта, выписка которого импортируется отдельно:
  // её исходящая нога уже даёт ровно одну строку transfer.
  const isMirroredIncome = (o: TochkaOperation) => {
    const n = cpAcc(o);
    return o.direction === "income" && !!n && statementNumbers.has(n);
  };

  const keep = ops.filter((o) => o.amountMinor > 0 && !isMirroredIncome(o));
  const list = [...new Map(keep.map((o) => [o.transactionId, o])).values()];

  // Контрагенты: ключ — ИНН, иначе имя. Для переводов не создаём.
  const cpMap = new Map<string, TochkaCounterparty>();
  for (const o of list) {
    const key = counterpartyKey(o);
    if (!key || cpMap.has(key) || isTransfer(o)) continue;
    cpMap.set(key, {
      key,
      name: o.counterpartyName?.trim() || `ИНН ${o.counterpartyInn}`,
      inn: o.counterpartyInn?.trim() || null,
      kpp: o.counterpartyKpp,
      kind: o.direction === "income" ? "client" : "supplier",
    });
  }

  let transfers = 0;
  const rows = list.map((o): TochkaImportRow => {
    const transfer = isTransfer(o);
    if (transfer) transfers++;
    const n = cpAcc(o);
    const otherAccountId = (n && ownAccounts.get(n)) || null;
    // Направление перевода берём из банка: при зачислении наш счёт — получатель,
    // при списании — отправитель. Если второй счёт Basa неизвестен, его сторона
    // остаётся пустой, но знак движения по нашему счёту сохраняется.
    const incoming = o.direction === "income";
    const account_id = transfer && incoming ? otherAccountId : targetAccountId;
    const transfer_account_id = transfer ? (incoming ? targetAccountId : otherAccountId) : null;
    const type = transfer ? "transfer" : o.direction;
    const noteParts = [
      o.description,
      o.docNumber && `${o.docType ?? "Документ"} №${o.docNumber}`,
      transfer && !otherAccountId && o.counterpartyAccount &&
        `Перевод между своими счетами (${incoming ? "с" : "на"} ${o.counterpartyAccount})`,
    ].filter(Boolean);
    return {
      type,
      amount: o.amountMinor,
      currency: o.currency,
      account_id,
      transfer_account_id,
      category_id: transfer ? null : type === "income" ? defaultIncomeCat : defaultExpenseCat,
      counterparty_key: transfer ? null : counterpartyKey(o),
      occurred_on: o.date,
      note: noteParts.join(" · ") || null,
      external_id: o.transactionId,
      provider: "tochka",
      origin: "bank",
    };
  });

  return { rows, counterparties: [...cpMap.values()], transfers };
}
