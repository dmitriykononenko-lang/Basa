import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";

// Сверка оплат: сопоставляет открытые инвойсы с входящими операциями
// (из выписки Точки / импорта BMI) по сумме + валюте + плательщику (контрагент
// или ИНН) и ставит «оплачен». Один платёж не закрывает два инвойса.
export async function POST() {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const supabase = await createClient();
  const teamId = current.team.id;

  const { data: invsRaw } = await supabase
    .from("invoices")
    .select("id, amount, currency, issue_date, counterparty_id, buyer_inn")
    .eq("team_id", teamId)
    .in("status", ["payment_waiting", "payment_expired"])
    .order("issue_date", { ascending: true });
  const invs = invsRaw ?? [];
  if (invs.length === 0) return NextResponse.json({ ok: true, matched: 0 });

  // Уже привязанные к оплатам операции — исключаем из кандидатов.
  const { data: usedRows } = await supabase
    .from("invoices").select("paid_transaction_id").eq("team_id", teamId).not("paid_transaction_id", "is", null);
  const used = new Set<string>((usedRows ?? []).map((r) => r.paid_transaction_id as string).filter(Boolean));

  const minDate = invs.reduce((m, i) => (i.issue_date < m ? i.issue_date : m), invs[0].issue_date as string);
  const { data: txsRaw } = await supabase
    .from("transactions")
    .select("id, amount, currency, occurred_on, counterparty_id, counterparty:counterparties(inn)")
    .eq("team_id", teamId)
    .eq("type", "income")
    .eq("status", "actual")
    .gte("occurred_on", minDate)
    .order("occurred_on", { ascending: true });
  const txs = (txsRaw ?? []) as unknown as {
    id: string; amount: number; currency: string; occurred_on: string;
    counterparty_id: string | null; counterparty: { inn: string | null } | { inn: string | null }[] | null;
  }[];
  const txInn = (t: (typeof txs)[number]) => (Array.isArray(t.counterparty) ? t.counterparty[0]?.inn : t.counterparty?.inn) ?? null;

  let matched = 0;
  for (const inv of invs) {
    const tx = txs.find((t) =>
      !used.has(t.id) &&
      t.amount === inv.amount &&
      t.currency === inv.currency &&
      t.occurred_on >= (inv.issue_date as string) &&
      (
        (inv.counterparty_id && t.counterparty_id === inv.counterparty_id) ||
        (inv.buyer_inn && txInn(t) === inv.buyer_inn)
      ),
    );
    if (!tx) continue;
    const { error } = await supabase
      .from("invoices")
      .update({ status: "paid", paid_on: tx.occurred_on, paid_transaction_id: tx.id })
      .eq("id", inv.id);
    if (!error) { used.add(tx.id); matched++; }
  }

  return NextResponse.json({ ok: true, matched });
}
