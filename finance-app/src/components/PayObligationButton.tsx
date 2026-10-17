"use client";

import { useMemo, useState } from "react";
import { Select } from "@/components/ui/select";
import Combobox from "@/components/Combobox";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney, formatMoney, formatDate } from "@/lib/format";

type Account = { id: string; name: string; currency: string };
export type PayOp = { id: string; amount: number; currency: string; occurred_on: string };

export default function PayObligationButton({
  obligationId,
  userId,
  outstanding,
  currency,
  teamId,
  counterpartyId,
  accounts = [],
  ops = [],
}: {
  obligationId: string;
  userId: string;
  outstanding: number;
  currency: string;
  teamId?: string;
  counterpartyId?: string | null;
  accounts?: Account[];
  ops?: PayOp[];
}) {
  const router = useRouter();
  const matching = accounts.filter((a) => a.currency === currency);
  const matchingOps = ops.filter((o) => o.currency === currency);
  const opById = useMemo(() => new Map(matchingOps.map((o) => [o.id, o])), [matchingOps]);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(matching[0]?.id ?? "");
  const [linkedOpId, setLinkedOpId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickOp(id: string) {
    setLinkedOpId(id);
    const o = opById.get(id);
    if (o) setAmount(String(Math.min(o.amount, outstanding) / 100).replace(".", ","));
  }

  if (outstanding <= 0) {
    return (
      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
        Погашено
      </span>
    );
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Сумма больше нуля");
    if (minor > outstanding) return setError("Больше остатка");

    setLoading(true);
    const supabase = createClient();
    const today = new Date().toISOString().slice(0, 10);
    let transactionId: string | null = null;

    // Привязка к существующей операции — без создания новой (берём её как платёж)
    if (linkedOpId) {
      transactionId = linkedOpId;
    } else if (teamId && accountId && matching.length > 0) {
      const { data: tx, error: txErr } = await supabase
        .from("transactions")
        .insert({
          team_id: teamId,
          type: "expense",
          amount: minor,
          currency,
          account_id: accountId,
          counterparty_id: counterpartyId ?? null,
          occurred_on: today,
          note: "Выплата по обязательству",
          created_by: userId,
        })
        .select("id")
        .single();
      if (txErr) {
        setError(txErr.message);
        setLoading(false);
        return;
      }
      transactionId = tx?.id ?? null;
    }

    const { error } = await supabase.from("obligation_payments").insert({
      obligation_id: obligationId,
      amount: minor,
      paid_on: today,
      transaction_id: transactionId,
      created_by: userId,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setAmount("");
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
      >
        Погасить
      </button>
    );
  }

  return (
    <form onSubmit={pay} className="flex flex-wrap items-center justify-end gap-1">
      {matchingOps.length > 0 && (
        <Combobox
          className="w-44"
          value={linkedOpId}
          onChange={pickOp}
          placeholder="Из операции…"
          emptyLabel="— новая операция —"
          options={matchingOps.map((o) => ({ value: o.id, label: `${formatDate(o.occurred_on)} · ${formatMoney(o.amount, o.currency)}` }))}
        />
      )}
      <input
        type="text"
        inputMode="decimal"
        autoFocus
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={formatMoney(outstanding, currency)}
        className="w-24 rounded-full border border-slate-300 px-2.5 py-1 text-xs outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-800"
      />
      {!linkedOpId && matching.length > 0 && (
        <Select variant="pill" value={accountId} onChange={setAccountId} options={matching.map((a) => ({ value: a.id, label: a.name }))} />
      )}
      <button type="submit" disabled={loading} className="rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">
        {loading ? "…" : "OK"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="px-1 text-xs text-slate-400">✕</button>
      {error && <span className="w-full text-right text-xs text-red-500">{error}</span>}
    </form>
  );
}
