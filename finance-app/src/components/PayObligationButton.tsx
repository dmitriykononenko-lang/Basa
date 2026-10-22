"use client";

import { useMemo, useRef, useState } from "react";
import { Select } from "@/components/ui/select";
import Combobox from "@/components/Combobox";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney, formatMoney, formatDate, todayInTz } from "@/lib/format";
import { obligationLink } from "@/lib/obligation-link";

type Account = { id: string; name: string; currency: string };
export type PayOp = { id: string; amount: number; currency: string; occurred_on: string };

export default function PayObligationButton({
  obligationId,
  outstanding,
  currency,
  oblType = "payable",
  accounts = [],
  ops = [],
}: {
  obligationId: string;
  outstanding: number;
  currency: string;
  oblType?: "receivable" | "payable"; // payable закрывается расходом, receivable — приходом (в RPC)
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
  // Ключ идемпотентности — один на попытку погашения (сбрасывается после успеха).
  const reqId = useRef("");

  function pickOp(id: string) {
    reqId.current = ""; // другие параметры — новая попытка
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
    if (loading) return;
    setError(null);
    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Сумма больше нуля");
    if (minor > outstanding) return setError("Больше остатка");

    setLoading(true);
    const supabase = createClient();
    if (!reqId.current) reqId.current = crypto.randomUUID();

    if (linkedOpId) {
      // Привязка к существующей операции (та же валюта — список отфильтрован выше).
      const { error: linkErr } = await obligationLink(supabase, {
        obligationId, transactionId: linkedOpId, amount: minor, requestId: reqId.current,
      });
      if (linkErr) { setError(linkErr); setLoading(false); return; }
    } else {
      // Новая операция (счёт в валюте начисления) + разнесение — одной транзакцией в RPC;
      // без подходящего счёта — отметка погашения без операции.
      const { error: payErr } = await supabase.rpc("obligation_pay", {
        p_obligation: obligationId,
        p_account: matching.length > 0 && accountId ? accountId : null,
        p_amount: minor,
        p_occurred_on: todayInTz(),
        p_note: oblType === "receivable" ? "Оплата по обязательству" : "Выплата по обязательству",
        p_request_id: reqId.current,
      });
      if (payErr) { setError(payErr.message); setLoading(false); return; }
    }
    reqId.current = "";
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
        aria-label={`Сумма, ${currency}`}
        onChange={(e) => { reqId.current = ""; setAmount(e.target.value); }}
        placeholder={formatMoney(outstanding, currency)}
        className="w-24 rounded-full border border-slate-300 px-2.5 py-1 text-xs outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-800"
      />
      {!linkedOpId && matching.length > 0 && (
        <Select variant="pill" value={accountId} onChange={(v) => { reqId.current = ""; setAccountId(v); }} options={matching.map((a) => ({ value: a.id, label: a.name }))} />
      )}
      <button type="submit" disabled={loading} className="rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">
        {loading ? "…" : "OK"}
      </button>
      <button type="button" onClick={() => setOpen(false)} aria-label="Отмена" className="px-1 text-xs text-slate-400">✕</button>
      {error && <span className="w-full text-right text-xs text-red-500">{error}</span>}
    </form>
  );
}
