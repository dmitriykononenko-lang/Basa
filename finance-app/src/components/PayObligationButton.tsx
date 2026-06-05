"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney, formatMoney } from "@/lib/format";

export default function PayObligationButton({
  obligationId,
  userId,
  outstanding,
  currency,
}: {
  obligationId: string;
  userId: string;
  outstanding: number;
  currency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const { error } = await supabase.from("obligation_payments").insert({
      obligation_id: obligationId,
      amount: minor,
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
    <form onSubmit={pay} className="flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        autoFocus
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={formatMoney(outstanding, currency)}
        className="w-28 rounded-full border border-slate-300 px-2.5 py-1 text-xs outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-800"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
      >
        {loading ? "…" : "OK"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-1 text-xs text-slate-400"
      >
        ✕
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </form>
  );
}
