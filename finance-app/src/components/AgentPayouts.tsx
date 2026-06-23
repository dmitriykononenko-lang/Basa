"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";
import PayObligationButton, { type PayOp } from "@/components/PayObligationButton";

type Account = { id: string; name: string; currency: string };
export type Payout = {
  id: string;            // obligation id
  clientName: string;
  sourceDate: string | null;
  base: number;          // сумма прихода (база)
  commission: number;    // начислено комиссии
  currency: string;
  percent: number;
  paid: number;
  outstanding: number;
};

export default function AgentPayouts({
  teamId, userId, agentId, accounts, payouts, ops = [],
}: {
  teamId: string;
  userId: string;
  agentId: string;
  accounts: Account[];
  payouts: Payout[];
  ops?: PayOp[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outstanding = payouts.filter((p) => p.outstanding > 0);
  const totalOut = outstanding.reduce((s, p) => s + p.outstanding, 0);
  const mainCur = payouts[0]?.currency ?? "RUB";

  async function payAll() {
    if (outstanding.length === 0) return;
    if (!confirm(`Выплатить все комиссии (${outstanding.length})? Будут созданы расходные операции.`)) return;
    setBusy(true); setError(null);
    const supabase = createClient();
    const today = new Date().toISOString().slice(0, 10);
    for (const p of outstanding) {
      const acc = accounts.find((a) => a.currency === p.currency);
      let txId: string | null = null;
      if (acc) {
        const { data: tx, error: txErr } = await supabase.from("transactions").insert({
          team_id: teamId, type: "expense", amount: p.outstanding, currency: p.currency,
          account_id: acc.id, counterparty_id: agentId, occurred_on: today, note: "Агентская выплата", created_by: userId,
        }).select("id").single();
        if (txErr) { setBusy(false); setError(txErr.message); return; }
        txId = (tx as { id: string }).id;
      }
      const { error: pErr } = await supabase.from("obligation_payments").insert({
        obligation_id: p.id, amount: p.outstanding, paid_on: today, transaction_id: txId, created_by: userId,
      });
      if (pErr) { setBusy(false); setError(pErr.message); return; }
    }
    setBusy(false);
    toast.success(`Выплачено комиссий: ${outstanding.length}`);
    router.refresh();
  }

  return (
    <section className="rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
          Агентские выплаты
        </h2>
        <div className="flex items-center gap-2">
          <Link href={`/agents/${agentId}/report`} className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700">
            Отчёт (PDF)
          </Link>
          <Link href={`/agents/${agentId}/report?act=1`} className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700">
            Акт к выплате
          </Link>
          {totalOut > 0 && (
            <button onClick={payAll} disabled={busy} className="rounded-full bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Выплачиваем…" : `Выплатить всё · ${formatMoney(totalOut, mainCur)}`}
            </button>
          )}
        </div>
      </div>
      {error && <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}

      {payouts.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                <th className="px-3 py-2 font-medium">Клиент</th>
                <th className="px-3 py-2 font-medium">Приход</th>
                <th className="px-3 py-2 text-right font-medium">База</th>
                <th className="px-3 py-2 text-right font-medium">%</th>
                <th className="px-3 py-2 text-right font-medium">Комиссия</th>
                <th className="px-3 py-2 text-right font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                  <td className="px-3 py-2 text-slate-700 dark:text-neutral-300">{p.clientName}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-neutral-400">{p.sourceDate ? formatDate(p.sourceDate) : "—"}</td>
                  <td className="px-3 py-2 text-right text-slate-500 dark:text-neutral-400">{formatMoney(p.base, p.currency)}</td>
                  <td className="px-3 py-2 text-right text-slate-500 dark:text-neutral-400">{p.percent}%</td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-800 dark:text-neutral-200">{formatMoney(p.commission, p.currency)}</td>
                  <td className="px-3 py-2 text-right">
                    <PayObligationButton
                      obligationId={p.id}
                      userId={userId}
                      outstanding={p.outstanding}
                      currency={p.currency}
                      teamId={teamId}
                      counterpartyId={agentId}
                      accounts={accounts}
                      ops={ops}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-400">Пока нет начисленных комиссий. Они появятся после прихода денег от клиентов этого агента.</p>
      )}
    </section>
  );
}
