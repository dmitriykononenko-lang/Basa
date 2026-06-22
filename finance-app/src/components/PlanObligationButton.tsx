"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney, formatMoney } from "@/lib/format";
import { toast } from "@/lib/toast";

type Account = { id: string; name: string; currency: string };

// «Запланировать платёж» по обязательству → создаёт плановую операцию,
// привязанную к обязательству (obligation_id). При её проведении обязательство гасится.
export default function PlanObligationButton({
  obligationId,
  teamId,
  userId,
  oblType,
  outstanding,
  currency,
  counterpartyId,
  categoryId = null,
  projectId = null,
  dueDate = null,
  accounts = [],
  alreadyScheduled = false,
}: {
  obligationId: string;
  teamId: string;
  userId: string;
  oblType: "payable" | "receivable";
  outstanding: number;
  currency: string;
  counterpartyId?: string | null;
  categoryId?: string | null;
  projectId?: string | null;
  dueDate?: string | null;
  accounts?: Account[];
  alreadyScheduled?: boolean;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const matching = accounts.filter((a) => a.currency === currency);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(dueDate ?? today);
  const [accountId, setAccountId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (alreadyScheduled) {
    return (
      <span className="text-xs font-medium text-brand" title="Платёж уже запланирован">
        Запланировано
      </span>
    );
  }
  if (outstanding <= 0) return null;

  async function plan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const minor = amount.trim() ? parseMoney(amount) : outstanding;
    if (minor <= 0) return setError("Сумма больше нуля");
    if (minor > outstanding) return setError("Больше остатка");

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("transactions").insert({
      team_id: teamId,
      type: oblType === "payable" ? "expense" : "income",
      amount: minor,
      currency,
      account_id: accountId || null,
      category_id: categoryId,
      counterparty_id: counterpartyId ?? null,
      project_id: projectId,
      occurred_on: date,
      status: "planned",
      obligation_id: obligationId,
      created_by: userId,
    });
    if (error) {
      // нарушение уникального индекса = уже запланировано
      setError(error.code === "23505" ? "Платёж уже запланирован" : error.message);
      setLoading(false);
      return;
    }
    setOpen(false);
    setLoading(false);
    toast.success("Платёж запланирован");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
        title="Создать плановую операцию по сроку"
      >
        Запланировать
      </button>
    );
  }

  return (
    <form onSubmit={plan} className="flex flex-wrap items-center justify-end gap-1">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-full border border-slate-300 px-2 py-1 text-xs outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-800"
        title="Дата платежа"
      />
      <input
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={formatMoney(outstanding, currency)}
        className="w-24 rounded-full border border-slate-300 px-2.5 py-1 text-xs outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-800"
        title="Сумма (по умолчанию — весь остаток)"
      />
      {matching.length > 0 && (
        <Select variant="pill" value={accountId} onChange={setAccountId} placeholder="— счёт —" options={[{ value: "", label: "— счёт —" }, ...matching.map((a) => ({ value: a.id, label: a.name }))]} />
      )}
      <button type="submit" disabled={loading} className="rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">
        {loading ? "…" : "OK"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="px-1 text-xs text-slate-400">✕</button>
      {error && <span className="w-full text-right text-xs text-red-500">{error}</span>}
    </form>
  );
}
