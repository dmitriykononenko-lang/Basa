"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import { toBaseStrict, type RateMap } from "@/lib/fx";
import { toast } from "@/lib/toast";
import AnchoredPopover from "@/components/AnchoredPopover";

type Cand = {
  id: string; // transaction_id — привязка (obligation_payments) идёт к операции
  isSplit: boolean;
  occurred_on: string;
  amount: number;
  currency: string;
  note: string | null;
  remainingBase: number; // непривязанный остаток в базовой валюте
};

export default function LinkPaymentButton({
  obligationId, oblType, counterpartyId, currency, outstanding, teamId, userId,
  rates, baseCurrency,
}: {
  obligationId: string;
  oblType: "receivable" | "payable";
  counterpartyId: string | null;
  currency: string;
  outstanding: number;
  teamId: string;
  userId: string;
  rates: RateMap;
  baseCurrency: string;
}) {
  const router = useRouter();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cands, setCands] = useState<Cand[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [noRateCount, setNoRateCount] = useState(0);

  if (outstanding <= 0 || !counterpartyId) return null;
  const txType = oblType === "payable" ? "expense" : "income";

  async function load() {
    setOpen(true); setLoading(true); setLoadError(null); setNoRateCount(0);
    const supabase = createClient();
    // Кандидаты — строки управленческого слоя (transaction_lines) по этому контрагенту:
    // если операция разнесена на части, берём только часть, отнесённую контрагенту,
    // а не всю операцию (SPLIT-01). Любая валюта — остаток считаем в базовой.
    const { data: lines, error: linesErr } = await supabase.from("transaction_lines")
      .select("transaction_id, split_id, occurred_on, amount, currency, note, is_split")
      .eq("team_id", teamId).eq("counterparty_id", counterpartyId).eq("type", txType)
      .eq("status", "actual")
      .order("occurred_on", { ascending: false }).limit(200);
    if (linesErr) { setLoadError("Не удалось загрузить операции. Попробуйте ещё раз."); setLoading(false); return; }
    // Части одной операции этому же контрагенту складываем: привязка хранится по операции
    const byTx = new Map<string, { id: string; occurred_on: string; amount: number; currency: string; note: string | null; isSplit: boolean }>();
    for (const l of (lines ?? []) as { transaction_id: string; occurred_on: string; amount: number; currency: string; note: string | null; is_split: boolean }[]) {
      const cur = byTx.get(l.transaction_id);
      if (cur) cur.amount += l.amount;
      else byTx.set(l.transaction_id, { id: l.transaction_id, occurred_on: l.occurred_on, amount: l.amount, currency: l.currency, note: l.note, isSplit: l.is_split });
    }
    const list = [...byTx.values()].slice(0, 100);
    const ids = list.map((t) => t.id);
    // Уже привязано из этих операций — только к обязательствам ЭТОГО контрагента
    // (часть операции другому сотруднику не уменьшает его остаток).
    const alloc = new Map<string, number>();
    if (ids.length) {
      const [{ data: obls, error: oblErr }, { data: pays, error: payErr }] = await Promise.all([
        supabase.from("obligations").select("id").eq("team_id", teamId).eq("counterparty_id", counterpartyId),
        supabase.from("obligation_payments").select("transaction_id, obligation_id, amount").in("transaction_id", ids),
      ]);
      if (oblErr || payErr) { setLoadError("Не удалось проверить привязки. Попробуйте ещё раз."); setLoading(false); return; }
      const mine = new Set(((obls ?? []) as { id: string }[]).map((o) => o.id));
      for (const p of (pays ?? []) as { transaction_id: string | null; obligation_id: string; amount: number }[]) {
        if (p.transaction_id && mine.has(p.obligation_id)) alloc.set(p.transaction_id, (alloc.get(p.transaction_id) ?? 0) + p.amount);
      }
    }
    let skipped = 0;
    const out: Cand[] = [];
    for (const t of list) {
      const b = toBaseStrict(t.amount, t.currency, rates);
      if (b === null) { skipped++; continue; } // нет курса — не пересчитываем 1:1
      const remainingBase = b - (alloc.get(t.id) ?? 0);
      if (remainingBase > 0) out.push({ ...t, remainingBase });
    }
    setNoRateCount(skipped);
    setCands(out);
    setLoading(false);
  }
  async function link(t: Cand) {
    setBusy(true);
    const supabase = createClient();
    // Обязательство обычно в базовой валюте команды; остаток выплаты уже в базовой.
    const amount = Math.min(t.remainingBase, outstanding);
    const { error } = await supabase.from("obligation_payments").insert({
      obligation_id: obligationId, amount, paid_on: t.occurred_on, transaction_id: t.id, created_by: userId,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setOpen(false);
    toast.success("Операция привязана к обязательству");
    router.refresh();
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : load())}
        aria-expanded={open}
        className="rounded-full px-3 py-1 text-xs font-medium text-brand transition hover:bg-brand/5"
      >
        Привязать
      </button>
      {open && (
        <AnchoredPopover
          anchorRef={btnRef}
          onClose={() => setOpen(false)}
          className="max-h-72 w-80 overflow-auto rounded-xl border border-slate-200 bg-white p-1 text-left shadow-xl dark:border-white/10 dark:bg-[#1b1d22]"
        >
          <div className="px-2 py-1.5 text-xs text-slate-400">{txType === "expense" ? "Выплата" : "Оплата"} этому контрагенту (непривязанный остаток)</div>
          {loading ? (
            <div className="px-2 py-3 text-sm text-slate-400">Загрузка…</div>
          ) : loadError ? (
            <div role="alert" className="px-2 py-3 text-sm text-red-600 dark:text-red-400">{loadError}</div>
          ) : cands.length > 0 ? (
            cands.map((t) => (
              <button key={t.id} onClick={() => link(t)} disabled={busy}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-white/[0.06]">
                <span className="truncate text-slate-600 dark:text-neutral-300">
                  {formatDate(t.occurred_on)}{t.note ? ` · ${t.note}` : ""}{t.isSplit ? " · часть" : ""}
                  {t.currency !== baseCurrency && <span className="text-slate-400"> · {formatMoney(t.amount, t.currency)}</span>}
                </span>
                <span className="shrink-0 font-medium text-slate-800 dark:text-neutral-100">{formatMoney(t.remainingBase, baseCurrency)}</span>
              </button>
            ))
          ) : (
            <div className="px-2 py-3 text-sm text-slate-400">Нет операций с непривязанным остатком.</div>
          )}
          {!loading && noRateCount > 0 && (
            <div className="px-2 pb-1.5 text-xs text-amber-700 dark:text-amber-400">Скрыто операций без курса валюты: {noRateCount}.</div>
          )}
        </AnchoredPopover>
      )}
    </>
  );
}
