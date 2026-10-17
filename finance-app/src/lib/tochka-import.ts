import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchOperationsWindowed } from "@/lib/tochka";
import { buildTochkaRows, normalizeAccountNumber } from "@/lib/tochka-import-rows";

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
    ownNumbers: Set<string>;          // номера счетов из getAccounts (их выписки импортируются)
    acctMap: Map<string, string>;     // все свои счета Basa: номер → id (loadOwnAccountMap)
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

  // Перевод между своими счетами учитываем один раз, с направлением из банка.
  // CSV-импорт обязан приводить перевод к тому же виду (см. tochka-import-rows.ts).
  const { rows, counterparties, transfers } = buildTochkaRows(ops, {
    statementNumbers: ownNumbers,
    ownAccounts: acctMap,
    targetAccountId,
    defaultIncomeCat,
    defaultExpenseCat,
  });
  if (rows.length === 0) return { imported: 0, skipped: 0, transfers: 0, counterparties: 0, total: 0 };

  const { data, error } = await supabase.rpc("bank_import_commit", {
    p_team: teamId,
    p_batch: {
      file_name: `Точка ${from} — ${to}`,
      bank: "tochka",
      account_id: targetAccountId,
      status: "imported",
    },
    p_rows: rows,
    p_counterparties: counterparties,
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

// Свои счета команды: номер → id счёта Basa. Источники — привязки
// bank_account_links и реквизит accounts.number. Второй нужен для счетов, которых
// нет в getAccounts (архивные, без привязки): без него входящий перевод с такого
// счёта не распознавался как свой (миграция 0095, архивный фонд …183872).
// Привязка важнее реквизита; номер, указанный у нескольких счетов, не используем.
export async function loadOwnAccountMap(supabase: SupabaseClient, teamId: string): Promise<Map<string, string>> {
  const [{ data: accRows, error: accErr }, { data: linkRows, error: linkErr }] = await Promise.all([
    supabase.from("accounts").select("id, number").eq("team_id", teamId).not("number", "is", null),
    supabase.from("bank_account_links").select("external_account, account_id").eq("team_id", teamId).eq("provider", "tochka"),
  ]);
  if (accErr) throw new Error(accErr.message);
  if (linkErr) throw new Error(linkErr.message);

  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const a of accRows ?? []) {
    const n = normalizeAccountNumber(a.number);
    if (!n) continue;
    if (map.has(n) && map.get(n) !== a.id) ambiguous.add(n);
    else map.set(n, a.id);
  }
  for (const n of ambiguous) map.delete(n);
  for (const l of linkRows ?? []) {
    const n = normalizeAccountNumber(l.external_account);
    if (n && l.account_id) map.set(n, l.account_id);
  }
  return map;
}
