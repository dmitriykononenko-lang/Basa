// Нераспределённые выплаты: фактические операции контрагентам, у которых есть
// открытые обязательства, но операция ещё не полностью «разнесена» по ним.
// После 0099 остаток операции = t.amount − Σ payment_amount (в валюте операции,
// без FX); до миграции / для строк без payment_amount — прежний расчёт в базовой
// валюте (obligation_payments.amount считаем базовой). См. unallocated-calc.ts.

import { toBase, type RateMap } from "@/lib/fx";
import { calcUnallocated, hasUnallocatedRemainder, type AllocationLink } from "@/lib/unallocated-calc";
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
  remaining: number | null; // минорные, валюта операции; null — нет payment_amount (до 0099)
};

// Ошибку чтения не глотаем: пустая выборка привязок завысила бы остаток
// («всё не разнесено»). Бросаем — страница покажет ошибку вместо неверных сумм.
function unallocatedError(what: string, e: { code?: string; message?: string }): Error {
  return new Error(`Нераспределённые выплаты: не удалось прочитать ${what} (${e.code ?? "?"}): ${e.message ?? ""}`);
}

export async function loadUnallocatedPayments(
  supabase: SupabaseClient,
  teamId: string,
  rates: RateMap
): Promise<UnallocatedPayment[]> {
  // 1. Контрагенты с открытыми обязательствами по типу
  //    payable (мы должны) закрывается расходами, receivable (нам должны) — доходами.
  const { data: obl, error: oblErr } = await supabase
    .from("obligation_balances")
    .select("type, outstanding, counterparty_id")
    .eq("team_id", teamId)
    .gt("outstanding", 0);
  if (oblErr) throw unallocatedError("обязательства", oblErr);
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
  const { data: txs, error: txErr } = await supabase
    .from("transactions")
    .select("id, type, amount, currency, occurred_on, note, counterparty_id, counterparty:counterparties(name)")
    .eq("team_id", teamId)
    .eq("status", "actual")
    .in("type", ["income", "expense"])
    .in("counterparty_id", allCps)
    .order("occurred_on", { ascending: false });
  if (txErr) throw unallocatedError("операции", txErr);
  const rows = (txs ?? []) as unknown as {
    id: string; type: "income" | "expense"; amount: number; currency: string;
    occurred_on: string; note: string | null; counterparty_id: string;
    counterparty: { name: string } | null;
  }[];
  const relevant = rows.filter((t) =>
    t.type === "expense" ? payableCps.has(t.counterparty_id) : receivableCps.has(t.counterparty_id)
  );
  if (relevant.length === 0) return [];

  // 3. Уже разнесённые части по этим операциям. payment_amount появляется в 0099;
  //    пока колонки нет (42703) — читаем без неё, расчёт уйдёт в прежний fallback.
  const ids = relevant.map((t) => t.id);
  const linksByTx = new Map<string, AllocationLink[]>();
  let withPaymentAmount = true;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    let pays: unknown[] | null = null;
    if (withPaymentAmount) {
      const res = await supabase
        .from("obligation_payments")
        .select("transaction_id, amount, payment_amount")
        .in("transaction_id", chunk);
      if (res.error?.code === "42703") withPaymentAmount = false;
      else if (res.error) throw unallocatedError("привязки", res.error);
      else pays = res.data;
    }
    if (!withPaymentAmount) {
      const res = await supabase
        .from("obligation_payments")
        .select("transaction_id, amount")
        .in("transaction_id", chunk);
      if (res.error) throw unallocatedError("привязки", res.error);
      pays = res.data;
    }
    for (const p of (pays ?? []) as { transaction_id: string | null; amount: number; payment_amount?: number | null }[]) {
      if (!p.transaction_id) continue;
      const list = linksByTx.get(p.transaction_id) ?? [];
      list.push({ amount: Number(p.amount), payment_amount: p.payment_amount ?? null });
      linksByTx.set(p.transaction_id, list);
    }
  }

  // 4. Остаток: по payment_amount в валюте операции, в базовой — для сумм и сортировки
  const out: UnallocatedPayment[] = [];
  for (const t of relevant) {
    const calc = calcUnallocated(t, linksByTx.get(t.id) ?? [], (m, c) => toBase(m, c, rates));
    if (!hasUnallocatedRemainder(calc)) continue;
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
      allocatedBase: calc.allocatedBase,
      paidBase: calc.paidBase,
      remainingBase: calc.remainingBase,
      remaining: calc.remaining,
    });
  }
  return out.sort((a, b) => b.remainingBase - a.remainingBase);
}
