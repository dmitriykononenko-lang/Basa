import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchOperationsWindowed, type TochkaOperation } from "@/lib/tochka";

export type ImportResult = {
  imported: number;
  skipped: number;
  transfers: number;
  counterparties: number;
  total: number;
  batchId?: string | null;
};

// Ядро импорта выписки Точки на один счёт: тянет операции окнами, дедупит,
// заводит контрагентов, помечает переводы и пишет батчем. Используется и ручным
// импортом (route), и фоновым автоимпортом (cron). Поведение должно совпадать.
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
  },
): Promise<ImportResult> {
  const {
    teamId, token, apiVersion, ownNumbers, acctMap, targetAccountId, accountId,
    defaultIncomeCat, defaultExpenseCat, from, to, createdBy,
  } = p;

  const ops = await fetchOperationsWindowed({ token, apiVersion, accountId, from, to });

  // Перевод между своими счетами учитываем один раз — только исходящую (Debit) ногу.
  const isInternal = (o: { counterpartyAccount: string | null }) => !!o.counterpartyAccount && ownNumbers.has(o.counterpartyAccount);
  const keep = ops.filter((o) => o.amountMinor > 0 && !(isInternal(o) && o.direction === "income"));

  const byId = new Map(keep.map((o) => [o.transactionId, o]));
  const ids = [...byId.keys()];
  if (ids.length === 0) return { imported: 0, skipped: 0, transfers: 0, counterparties: 0, total: 0 };

  const { data: existingRows } = await supabase
    .from("transactions").select("external_id")
    .eq("team_id", teamId).eq("source", "tochka").in("external_id", ids);
  const existing = new Set((existingRows ?? []).map((r) => r.external_id));
  const fresh = [...byId.values()].filter((o) => !existing.has(o.transactionId));

  // ── Контрагенты: матчим по ИНН, иначе по имени; недостающих создаём ──────────
  const { data: cpRows } = await supabase
    .from("counterparties").select("id, name, inn").eq("team_id", teamId);
  const cpByInn = new Map<string, string>();
  const cpByName = new Map<string, string>();
  for (const c of cpRows ?? []) {
    if (c.inn) cpByInn.set(String(c.inn).trim(), c.id);
    if (c.name) cpByName.set(c.name.trim().toLowerCase(), c.id);
  }
  const resolveCp = (o: TochkaOperation): string | null => {
    if (o.counterpartyInn && cpByInn.has(o.counterpartyInn.trim())) return cpByInn.get(o.counterpartyInn.trim())!;
    if (o.counterpartyName && cpByName.has(o.counterpartyName.trim().toLowerCase())) return cpByName.get(o.counterpartyName.trim().toLowerCase())!;
    return null;
  };

  const toCreate = new Map<string, { name: string; inn: string | null; kpp: string | null; kind: string }>();
  for (const o of fresh) {
    if (!o.counterpartyName && !o.counterpartyInn) continue;
    if (resolveCp(o)) continue;
    const key = o.counterpartyInn?.trim() || o.counterpartyName!.trim().toLowerCase();
    if (toCreate.has(key)) continue;
    const isTransfer = !!o.counterpartyAccount && ownNumbers.has(o.counterpartyAccount);
    const kind = isTransfer ? "other" : o.direction === "income" ? "client" : "supplier";
    toCreate.set(key, { name: o.counterpartyName?.trim() || `ИНН ${o.counterpartyInn}`, inn: o.counterpartyInn?.trim() || null, kpp: o.counterpartyKpp, kind });
  }
  if (toCreate.size > 0) {
    const { data: created } = await supabase
      .from("counterparties")
      .insert([...toCreate.values()].map((c) => ({ team_id: teamId, name: c.name, inn: c.inn, kpp: c.kpp, kind: c.kind })))
      .select("id, name, inn");
    for (const c of created ?? []) {
      if (c.inn) cpByInn.set(String(c.inn).trim(), c.id);
      if (c.name) cpByName.set(c.name.trim().toLowerCase(), c.id);
    }
  }

  let transfers = 0;
  const rows = fresh.map((o) => {
    const isInternalAcc = !!o.counterpartyAccount && ownNumbers.has(o.counterpartyAccount);
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
      team_id: teamId,
      type,
      amount: o.amountMinor,
      currency: o.currency,
      account_id: targetAccountId,
      transfer_account_id,
      category_id,
      counterparty_id: resolveCp(o),
      occurred_on: o.date,
      note: noteParts.join(" · ") || null,
      created_by: createdBy,
      external_id: o.transactionId,
      source: "tochka",
    };
  });

  const skipped = byId.size - rows.length;
  if (rows.length === 0) return { imported: 0, skipped, transfers: 0, counterparties: toCreate.size, total: byId.size };

  const { data: batch, error: batchErr } = await supabase
    .from("import_batches")
    .insert({
      team_id: teamId,
      created_by: createdBy,
      file_name: `Точка ${from} — ${to}`,
      account_id: targetAccountId,
      bank: "tochka",
      row_count: rows.length,
      status: "imported",
    })
    .select("id")
    .single();
  if (batchErr || !batch) throw new Error(batchErr?.message ?? "Ошибка батча");

  const { error: insErr } = await supabase
    .from("transactions")
    .insert(rows.map((r) => ({ ...r, import_batch_id: batch.id })));
  if (insErr) {
    await supabase.from("import_batches").delete().eq("id", batch.id);
    throw new Error(insErr.message);
  }

  return { imported: rows.length, skipped, transfers, counterparties: toCreate.size, total: byId.size, batchId: batch.id };
}
