// Клиентская часть привязки операции к начислению (RPC obligation_link, миграция 0099):
// кандидаты с остатком в валюте операции, подсказка курса ЦБ и вызов RPC.
// Вся запись — только через RPC; здесь нет insert/update в obligation_payments.

import type { SupabaseClient } from "@supabase/supabase-js";
import { candidateRemaining, crossRate, type ExistingLink, type FxMethod } from "@/lib/obligation-link-calc";

export type LinkCandidate = {
  id: string; // transaction_id
  occurred_on: string;
  amount: number; // часть операции этому контрагенту, валюта операции
  currency: string; // валюта операции
  note: string | null;
  isSplit: boolean;
  /** Непривязанный остаток в валюте операции; null — «нужна сверка» (нельзя привязать). */
  remaining: number | null;
};

type LineRow = {
  transaction_id: string; occurred_on: string; amount: number; transaction_amount: number;
  currency: string; note: string | null; is_split: boolean;
};
type PayRow = { transaction_id: string | null; obligation_id: string; amount: number; payment_amount?: number | null };

const CHUNK = 100;

/**
 * Операции контрагента (из управленческого слоя transaction_lines — только его часть,
 * SPLIT-01) с непривязанным остатком. transactionId — только эта операция.
 */
export async function loadLinkCandidates(
  supabase: SupabaseClient,
  opts: { teamId?: string; counterpartyId: string; txType: "income" | "expense"; transactionId?: string },
): Promise<{ cands: LinkCandidate[]; error: string | null }> {
  let q = supabase.from("transaction_lines")
    .select("transaction_id, occurred_on, amount, transaction_amount, currency, note, is_split")
    .eq("counterparty_id", opts.counterpartyId).eq("type", opts.txType).eq("status", "actual");
  if (opts.teamId) q = q.eq("team_id", opts.teamId);
  if (opts.transactionId) q = q.eq("transaction_id", opts.transactionId);
  const { data: lines, error: linesErr } = await q.order("occurred_on", { ascending: false }).limit(200);
  if (linesErr) return { cands: [], error: "Не удалось загрузить операции. Попробуйте ещё раз." };

  // Части одной операции этому контрагенту складываем: привязка хранится по операции.
  type Agg = { id: string; occurred_on: string; amount: number; whole: number; currency: string; note: string | null; isSplit: boolean };
  const byTx = new Map<string, Agg>();
  for (const l of (lines ?? []) as LineRow[]) {
    const cur = byTx.get(l.transaction_id);
    if (cur) cur.amount += Number(l.amount);
    else byTx.set(l.transaction_id, {
      id: l.transaction_id, occurred_on: l.occurred_on, amount: Number(l.amount), whole: Number(l.transaction_amount),
      currency: l.currency, note: l.note, isSplit: l.is_split,
    });
  }
  const list = [...byTx.values()].slice(0, 100);
  const ids = list.map((t) => t.id);

  // Привязки этих операций — ВСЕ (к любым начислениям): остаток считается и от всей
  // операции, иначе операцию, закрывшую начисление другого контрагента, можно привязать повторно.
  // payment_amount появляется в 0099; пока колонки нет (42703) — читаем без неё.
  const pays: PayRow[] = [];
  let withPaymentAmount = true;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    if (withPaymentAmount) {
      const res = await supabase.from("obligation_payments")
        .select("transaction_id, obligation_id, amount, payment_amount").in("transaction_id", chunk);
      if (res.error?.code === "42703") withPaymentAmount = false;
      else if (res.error) return { cands: [], error: "Не удалось проверить привязки. Попробуйте ещё раз." };
      else { pays.push(...((res.data ?? []) as PayRow[])); continue; }
    }
    const res = await supabase.from("obligation_payments")
      .select("transaction_id, obligation_id, amount").in("transaction_id", chunk);
    if (res.error) return { cands: [], error: "Не удалось проверить привязки. Попробуйте ещё раз." };
    pays.push(...((res.data ?? []) as PayRow[]));
  }

  const oblIds = [...new Set(pays.map((p) => p.obligation_id))];
  const oblInfo = new Map<string, { counterparty_id: string | null; currency: string }>();
  for (let i = 0; i < oblIds.length; i += CHUNK) {
    const { data, error } = await supabase.from("obligations")
      .select("id, counterparty_id, currency").in("id", oblIds.slice(i, i + CHUNK));
    if (error) return { cands: [], error: "Не удалось проверить привязки. Попробуйте ещё раз." };
    for (const o of (data ?? []) as { id: string; counterparty_id: string | null; currency: string }[]) {
      oblInfo.set(o.id, { counterparty_id: o.counterparty_id, currency: o.currency });
    }
  }

  const linksByTx = new Map<string, ExistingLink[]>();
  for (const p of pays) {
    if (!p.transaction_id) continue;
    const o = oblInfo.get(p.obligation_id);
    const arr = linksByTx.get(p.transaction_id) ?? [];
    arr.push({
      amount: Number(p.amount),
      payment_amount: p.payment_amount ?? null,
      oblCurrency: o?.currency ?? null,
      mine: o?.counterparty_id === opts.counterpartyId,
    });
    linksByTx.set(p.transaction_id, arr);
  }

  const cands: LinkCandidate[] = [];
  for (const t of list) {
    const remaining = candidateRemaining({ part: t.amount, whole: t.whole, currency: t.currency }, linksByTx.get(t.id) ?? []);
    if (remaining === null || remaining > 0) {
      cands.push({ id: t.id, occurred_on: t.occurred_on, amount: t.amount, currency: t.currency, note: t.note, isSplit: t.isSplit, remaining });
    }
  }
  return { cands, error: null };
}

export type FxHint = { rate: number; rateDate: string } | { rate: null; error: string };

async function cbrRub(currency: string, date: string): Promise<{ rate: number; rate_date: string } | { error: string }> {
  if (currency === "RUB") return { rate: 1, rate_date: date };
  try {
    const res = await fetch(`/api/fx/cbr?currency=${encodeURIComponent(currency)}&date=${encodeURIComponent(date)}`, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { rate?: number; rate_date?: string; error?: string } | null;
    if (!res.ok || !body || typeof body.rate !== "number" || !(body.rate > 0) || !body.rate_date) {
      return { error: body?.error || `Курс ЦБ для ${currency} недоступен` };
    }
    return { rate: body.rate, rate_date: body.rate_date };
  } catch {
    return { error: "Не удалось получить курс ЦБ" };
  }
}

/**
 * Курс ЦБ на дату операции: сколько единиц валюты начисления за 1 единицу валюты операции.
 * rateDate — дата котировки валюты операции (или начисления, если операция в рублях).
 */
export async function fetchFxHint(payCurrency: string, oblCurrency: string, date: string): Promise<FxHint> {
  const [pay, obl] = await Promise.all([cbrRub(payCurrency, date), cbrRub(oblCurrency, date)]);
  if ("error" in pay) return { rate: null, error: pay.error };
  if ("error" in obl) return { rate: null, error: obl.error };
  return { rate: crossRate(pay.rate, obl.rate), rateDate: payCurrency !== "RUB" ? pay.rate_date : obl.rate_date };
}

export type LinkResult = {
  id: string; obligation_id: string; transaction_id: string;
  amount: number; payment_amount: number | null; payment_currency: string | null;
  fx_rate: number | null; fx_rate_date: string | null; fx_method: FxMethod | null;
  obligation_outstanding: number; transaction_remaining: number;
};

/** RPC obligation_link. p_amount — в валюте начисления; p_payment_amount и FX — только при разных валютах. */
export async function obligationLink(
  supabase: SupabaseClient,
  p: {
    obligationId: string; transactionId: string; amount: number; requestId: string;
    fx?: { paymentAmount: number; method: "CBR" | "MANUAL"; rate: number | null; rateDate: string | null };
  },
): Promise<{ data: LinkResult | null; error: string | null }> {
  const args: Record<string, unknown> = {
    p_obligation: p.obligationId,
    p_transaction: p.transactionId,
    p_amount: p.amount,
    p_request_id: p.requestId,
  };
  if (p.fx) {
    args.p_payment_amount = p.fx.paymentAmount;
    args.p_fx_method = p.fx.method;
    args.p_fx_rate_date = p.fx.rateDate;
    // Для CBR RPC требует курс из подсказки и сверяет с ним пару сумм; для MANUAL курс = amount / payment.
    if (p.fx.method === "CBR") args.p_fx_rate = p.fx.rate;
  }
  const { data, error } = await supabase.rpc("obligation_link", args);
  if (error) return { data: null, error: error.message || "Не удалось привязать операцию" };
  return { data: (data ?? null) as LinkResult | null, error: null };
}
