// Нераспределённые выплаты: фактические операции контрагентам, у которых есть
// открытые обязательства, но операция ещё не полностью «разнесена» по ним.
// Остаток считаем в базовой валюте (obligation_payments.amount хранится в валюте
// обязательства — для команд с базовой валютой это она же).

import { toBase, type RateMap } from "@/lib/fx";
import type { SupabaseClient } from "@supabase/supabase-js";

export type UnallocatedPayment = {
  id: string;
  occurred_on: string;
  amount: number; // минорные, валюта операции
  currency: string;
  note: string | null;
  type: "income" | "expense";
  counterparty_id: string;
  counterpartyName: string;
  oblType: "receivable" | "payable";
  allocatedBase: number; // минорные, базовая валюта
  paidBase: number; // минорные, базовая валюта
  remainingBase: number; // минорные, базовая валюта
};

export async function loadUnallocatedPayments(
  supabase: SupabaseClient,
  teamId: string,
  rates: RateMap
): Promise<UnallocatedPayment[]> {
  // 1. Контрагенты с открытыми обязательствами по типу
  //    payable (мы должны) закрывается расходами, receivable (нам должны) — доходами.
  const { data: obl } = await supabase
    .from("obligation_balances")
    .select("type, outstanding, counterparty_id")
    .eq("team_id", teamId)
    .gt("outstanding", 0);
  const payableCps = new Set<string>();
  const receivableCps = new Set<string>();
  for (const o of (obl ?? []) as { type: string; counterparty_id: string | null }[]) {
    if (!o.counterparty_id) continue;
    if (o.type === "payable") payableCps.add(o.counterparty_id);
    else receivableCps.add(o.counterparty_id);
  }
  const allCps = [...new Set([...payableCps, ...receivableCps])];
  if (allCps.length === 0) return [];

  // 2. Фактические доходы/расходы этим контрагентам
  const { data: txs } = await supabase
    .from("transactions")
    .select("id, type, amount, currency, occurred_on, note, counterparty_id, counterparty:counterparties(name)")
    .eq("team_id", teamId)
    .eq("status", "actual")
    .in("type", ["income", "expense"])
    .in("counterparty_id", allCps)
    .order("occurred_on", { ascending: false });
  const rows = (txs ?? []) as unknown as {
    id: string; type: "income" | "expense"; amount: number; currency: string;
    occurred_on: string; note: string | null; counterparty_id: string;
    counterparty: { name: string } | null;
  }[];
  const relevant = rows.filter((t) =>
    t.type === "expense" ? payableCps.has(t.counterparty_id) : receivableCps.has(t.counterparty_id)
  );
  if (relevant.length === 0) return [];

  // 3. Уже разнесённые суммы по этим операциям
  const ids = relevant.map((t) => t.id);
  const allocByTx = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data: pays } = await supabase
      .from("obligation_payments")
      .select("transaction_id, amount")
      .in("transaction_id", chunk);
    for (const p of (pays ?? []) as { transaction_id: string | null; amount: number }[]) {
      if (!p.transaction_id) continue;
      allocByTx.set(p.transaction_id, (allocByTx.get(p.transaction_id) ?? 0) + p.amount);
    }
  }

  // 4. Остаток в базовой валюте
  const out: UnallocatedPayment[] = [];
  for (const t of relevant) {
    const paidBase = toBase(t.amount, t.currency, rates);
    const allocatedBase = allocByTx.get(t.id) ?? 0;
    const remainingBase = paidBase - allocatedBase;
    if (remainingBase <= 0) continue;
    out.push({
      id: t.id,
      occurred_on: t.occurred_on,
      amount: t.amount,
      currency: t.currency,
      note: t.note,
      type: t.type,
      counterparty_id: t.counterparty_id,
      counterpartyName: t.counterparty?.name ?? "—",
      oblType: t.type === "expense" ? "payable" : "receivable",
      allocatedBase,
      paidBase,
      remainingBase,
    });
  }
  return out.sort((a, b) => b.remainingBase - a.remainingBase);
}
