import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchOperationsWindowed, type TochkaOperation } from "@/lib/tochka";

export type ImportResult = {
  imported: number;
  skipped: number;
  transfers: number;
  counterparties: number;
  total: number;
  batchId?: string | null;
  promoted?: number;
};

// Ядро импорта выписки Точки на один счёт: тянет операции окнами, приводит их к
// каноническому виду и отдаёт ОДНИМ вызовом RPC bank_import_commit.
//
// Что изменилось после аудита:
//  • дедуп, создание контрагентов, создание батча и вставка операций теперь
//    выполняются в одной транзакции БД. Раньше это были четыре отдельных
//    запроса с ручной компенсацией: при сбое вставки оставались осиротевшие
//    батчи и уже созданные контрагенты (аудит, T6);
//  • конфликт по одному событию больше не валит весь батч — пересечение
//    пропускается, остальное импортируется;
//  • идентичность банковского события задаётся в БД (origin + bank_event_id +
//    вычисляемый bank_event_fp), поэтому то же событие, пришедшее из CSV-выписки,
//    не создаёт второй записи (первопричина FIN-03).
export async function importTochkaStatement(
  supabase: SupabaseClient,
  p: {
    teamId: string;
    token: string;
    apiVersion: string;
    ownNumbers: Set<string>;
    acctMap: Map<string, string>;
    targetAccountId: string | null;
    accountId: string;
    defaultIncomeCat: string | null;
    defaultExpenseCat: string | null;
    from: string;
    to: string;
    createdBy: string | null;
    requestId?: string | null;
  },
): Promise<ImportResult> {
  const {
    teamId, token, apiVersion, ownNumbers, acctMap, targetAccountId, accountId,
    defaultIncomeCat, defaultExpenseCat, from, to, requestId,
  } = p;

  const ops = await fetchOperationsWindowed({ token, apiVersion, accountId, from, to });

  // Перевод между своими счетами учитываем один раз — только исходящую (Debit)
  // ногу. Это и есть каноническое представление внутреннего перевода: ОДНА
  // строка type='transfer'. CSV-импорт обязан приводить перевод к тому же виду.
  const isInternal = (o: { counterpartyAccount: string | null }) => !!o.counterpartyAccount && ownNumbers.has(o.counterpartyAccount);
  const keep = ops.filter((o) => o.amountMinor > 0 && !(isInternal(o) && o.direction === "income"));

  const byId = new Map(keep.map((o) => [o.transactionId, o]));
  const list = [...byId.values()];
  if (list.length === 0) return { imported: 0, skipped: 0, transfers: 0, counterparties: 0, total: 0 };

  // Контрагенты: ключ — ИНН, иначе имя. Сопоставление с существующими и
  // создание отсутствующих делает RPC в той же транзакции.
  const cpKey = (o: TochkaOperation): string | null => {
    const inn = o.counterpartyInn?.trim();
    const name = o.counterpartyName?.trim();
    if (inn) return `inn:${inn}`;
    if (name) return `name:${name.toLowerCase()}`;
    return null;
  };
  const cpMap = new Map<string, { key: string; name: string; inn: string | null; kpp: string | null; kind: string }>();
  for (const o of list) {
    const key = cpKey(o);
    if (!key || cpMap.has(key)) continue;
    const isTransfer = isInternal(o);
    cpMap.set(key, {
      key,
      name: o.counterpartyName?.trim() || `ИНН ${o.counterpartyInn}`,
      inn: o.counterpartyInn?.trim() || null,
      kpp: o.counterpartyKpp,
      kind: isTransfer ? "other" : o.direction === "income" ? "client" : "supplier",
    });
  }

  let transfers = 0;
  const rows = list.map((o) => {
    const isInternalAcc = isInternal(o);
    const isOwnFunds = /перевод\s+собственных\s+средств/i.test(o.description ?? "");
    const isTransfer = isInternalAcc || isOwnFunds;
    if (isTransfer) transfers++;
    const type = isTransfer ? "transfer" : o.direction;
    const category_id = isTransfer ? null : type === "income" ? defaultIncomeCat : defaultExpenseCat;
    const transfer_account_id = isInternalAcc ? (o.counterpartyAccount && acctMap.get(o.counterpartyAccount)) || null : null;
    const noteParts = [
      o.description,
      o.docNumber && `${o.docType ?? "Документ"} №${o.docNumber}`,
      isInternalAcc && !transfer_account_id && `Перевод между своими счетами (${o.counterpartyAccount})`,
    ].filter(Boolean);
    return {
      type,
      amount: o.amountMinor,
      currency: o.currency,
      account_id: targetAccountId,
      transfer_account_id,
      category_id,
      counterparty_key: isTransfer ? null : cpKey(o),
      occurred_on: o.date,
      note: noteParts.join(" · ") || null,
      external_id: o.transactionId,
      provider: "tochka",
      origin: "bank",
    };
  });

  const { data, error } = await supabase.rpc("bank_import_commit", {
    p_team: teamId,
    p_batch: {
      file_name: `Точка ${from} — ${to}`,
      bank: "tochka",
      account_id: targetAccountId,
      status: "imported",
    },
    p_rows: rows,
    p_counterparties: [...cpMap.values()],
    p_request_id: requestId ?? null,
  });
  if (error) throw new Error(error.message);

  const r = (data ?? {}) as {
    imported?: number; total?: number; batch_id?: string | null;
    skipped_by_event_id?: number; skipped_by_fingerprint?: number;
    promoted?: number; counterparties?: number;
  };
  const imported = r.imported ?? 0;
  const total = r.total ?? rows.length;
  return {
    imported,
    skipped: (r.skipped_by_event_id ?? 0) + (r.skipped_by_fingerprint ?? 0),
    transfers,
    counterparties: r.counterparties ?? 0,
    total,
    batchId: r.batch_id ?? null,
    promoted: r.promoted ?? 0,
  };
}
