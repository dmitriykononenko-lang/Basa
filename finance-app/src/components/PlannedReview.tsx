"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";
import Modal from "@/components/Modal";

type P = {
  id: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  occurred_on: string;
  note: string | null;
  account_id: string | null;
  transfer_account_id: string | null;
  accountName: string | null;
  toAccountName: string | null;
  categoryName: string | null;
  counterpartyName: string | null;
  projectName: string | null;
};

type ActualRow = {
  id: string; account_id: string | null; transfer_account_id: string | null;
  type: string; amount: number; occurred_on: string;
};

const SELECT =
  `id, type, amount, currency, occurred_on, note, account_id, transfer_account_id,
   account:accounts!transactions_account_id_fkey(name),
   to_account:accounts!transactions_transfer_account_id_fkey(name),
   category:categories(name), counterparty:counterparties(name), project:projects(name)`;

function daysBetween(a: string, b: string) {
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

export default function PlannedReview({
  teamId, userId, count, variant = "card",
}: {
  teamId: string;
  userId: string;
  count: number;
  variant?: "card" | "button";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<P[]>([]);
  const [idx, setIdx] = useState(0);
  const [editDate, setEditDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoClosed, setAutoClosed] = useState(0);
  const [stats, setStats] = useState({ confirmed: 0, conducted: 0, deleted: 0 });
  const [done, setDone] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setIdx(0); setDone(false);
    setStats({ confirmed: 0, conducted: 0, deleted: 0 }); setAutoClosed(0);
    (async () => {
      const supabase = createClient();
      const { data: pl } = await supabase
        .from("transactions").select(SELECT)
        .eq("team_id", teamId).eq("status", "planned")
        .order("occurred_on", { ascending: true });
      const planned = ((pl ?? []) as unknown as Array<P & {
        account: { name: string } | null; to_account: { name: string } | null;
        category: { name: string } | null; counterparty: { name: string } | null; project: { name: string } | null;
      }>).map((t) => ({
        id: t.id, type: t.type, amount: t.amount, currency: t.currency, occurred_on: t.occurred_on, note: t.note,
        account_id: t.account_id, transfer_account_id: t.transfer_account_id,
        accountName: t.account?.name ?? null, toAccountName: t.to_account?.name ?? null,
        categoryName: t.category?.name ?? null, counterpartyName: t.counterparty?.name ?? null, projectName: t.project?.name ?? null,
      })) as P[];

      // Факт в окне дат — для авто-склейки
      let actuals: ActualRow[] = [];
      if (planned.length > 0) {
        const dates = planned.map((p) => p.occurred_on).sort();
        const lo = new Date(new Date(dates[0]).getTime() - 5 * 86400000).toISOString().slice(0, 10);
        const hi = new Date(new Date(dates[dates.length - 1]).getTime() + 5 * 86400000).toISOString().slice(0, 10);
        const { data } = await supabase
          .from("transactions").select("id, account_id, transfer_account_id, type, amount, occurred_on")
          .eq("team_id", teamId).eq("status", "actual").gte("occurred_on", lo).lte("occurred_on", hi);
        actuals = (data ?? []) as ActualRow[];
      }

      // Авто-склейка: плановая, по которой уже есть факт → закрываем плановую
      const usedActual = new Set<string>();
      const toClose: string[] = [];
      const remaining: P[] = [];
      for (const p of planned) {
        const m = actuals.find((a) =>
          !usedActual.has(a.id) && a.type === p.type && a.amount === p.amount && a.account_id === p.account_id &&
          (p.type !== "transfer" || a.transfer_account_id === p.transfer_account_id) &&
          daysBetween(a.occurred_on, p.occurred_on) <= 5
        );
        if (m) { usedActual.add(m.id); toClose.push(p.id); }
        else remaining.push(p);
      }
      if (toClose.length > 0) await supabase.from("transactions").delete().in("id", toClose);
      if (cancelled) return;
      setAutoClosed(toClose.length);
      setQueue(remaining);
      setEditDate(remaining[0]?.occurred_on ?? "");
      setLoading(false);
      if (toClose.length > 0) router.refresh();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, teamId]);

  const cur = queue[idx];

  function advance() {
    if (idx + 1 >= queue.length) { setDone(true); router.refresh(); }
    else { const n = idx + 1; setIdx(n); setEditDate(queue[n].occurred_on); }
  }

  async function confirmDate() {
    if (!cur) return;
    setBusy(true);
    if (editDate && editDate !== cur.occurred_on) {
      const supabase = createClient();
      const { error } = await supabase.from("transactions").update({ occurred_on: editDate }).eq("id", cur.id);
      if (error) { setBusy(false); return toast.error(error.message); }
    }
    setStats((s) => ({ ...s, confirmed: s.confirmed + 1 }));
    setBusy(false);
    advance();
  }

  async function conduct() {
    if (!cur) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("transactions")
      .update({ status: "actual", occurred_on: editDate || cur.occurred_on }).eq("id", cur.id);
    if (error) { setBusy(false); return toast.error(error.message); }
    setStats((s) => ({ ...s, conducted: s.conducted + 1 }));
    setBusy(false);
    toast.success("Операция проведена");
    advance();
  }

  async function removeOp() {
    if (!cur) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("transactions").delete().eq("id", cur.id);
    if (error) { setBusy(false); return toast.error(error.message); }
    setStats((s) => ({ ...s, deleted: s.deleted + 1 }));
    setBusy(false);
    advance();
  }

  const sign = (t: P) => (t.type === "income" ? "+" : t.type === "expense" ? "−" : "");
  const amtColor = (t: P) =>
    t.type === "income" ? "text-emerald-600 dark:text-emerald-400"
    : t.type === "expense" ? "text-red-600 dark:text-red-400"
    : "text-slate-700 dark:text-neutral-300";

  return (
    <>
      {variant === "card" ? (
        <button
          onClick={() => setOpen(true)}
          className="mb-6 flex w-full flex-wrap items-center justify-between gap-3 rounded-3xl bg-violet-50 px-5 py-4 text-left ring-1 ring-violet-200 transition hover:ring-violet-300 dark:bg-violet-950/25 dark:ring-violet-900/40"
        >
          <span className="text-sm text-violet-800 dark:text-violet-200">
            📋 Плановые платежи: <b>{count}</b> — проверьте по одной и подтвердите даты
          </span>
          <span className="text-sm font-medium text-violet-700 dark:text-violet-300">Проверить →</span>
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
        >
          📋 Плановые{count > 0 ? ` · ${count}` : ""}
        </button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Проверка плановых платежей">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
            <span className="spinner spinner-brand" /> Загружаем плановые…
          </div>
        ) : done || queue.length === 0 ? (
          <div className="py-8 text-center">
            <div className="mb-3 text-3xl">✓</div>
            <p className="text-base font-semibold text-slate-800 dark:text-neutral-100">
              {queue.length === 0 && !done ? "Все плановые в порядке" : "Готово"}
            </p>
            <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
              {autoClosed > 0 && <>Авто-закрыто фактом: <b>{autoClosed}</b>. </>}
              {(stats.confirmed > 0 || stats.conducted > 0 || stats.deleted > 0) && (
                <>Подтверждено: {stats.confirmed} · проведено: {stats.conducted} · удалено: {stats.deleted}.</>
              )}
            </p>
            <button onClick={() => setOpen(false)} className="btn-primary mt-5">Закрыть</button>
          </div>
        ) : cur ? (
          <div>
            {/* прогресс */}
            <div className="mb-4">
              <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                <span>{idx + 1} из {queue.length}</span>
                {autoClosed > 0 && <span>авто-закрыто фактом: {autoClosed}</span>}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
                <div className="h-1.5 rounded-full bg-brand transition-all" style={{ width: `${(idx / queue.length) * 100}%` }} />
              </div>
            </div>

            {/* карточка операции */}
            <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`text-2xl font-bold ${amtColor(cur)}`}>{sign(cur)}{formatMoney(cur.amount, cur.currency)}</div>
                  <div className="mt-1 text-sm font-medium text-slate-800 dark:text-neutral-200">
                    {cur.type === "transfer" ? "Перевод" : cur.categoryName ?? "Без статьи"}
                  </div>
                  {cur.counterpartyName && <div className="text-sm text-slate-500 dark:text-neutral-400">{cur.counterpartyName}</div>}
                  {cur.note && <div className="text-xs text-slate-400 dark:text-neutral-500">{cur.note}</div>}
                  <div className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
                    {cur.type === "transfer" ? `${cur.accountName} → ${cur.toAccountName}` : cur.accountName}
                    {cur.projectName && ` · ${cur.projectName}`}
                  </div>
                </div>
                {cur.occurred_on < today && (
                  <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40">просрочена</span>
                )}
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Плановая дата</label>
                <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="input w-48" />
              </div>
            </div>

            {/* действия */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={confirmDate} disabled={busy} className="btn-primary">
                {editDate !== cur.occurred_on ? "Перенести и далее" : "Подтвердить дату"}
              </button>
              <button onClick={conduct} disabled={busy} className="rounded-full bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/40">
                Провести (оплачено)
              </button>
              <button onClick={advance} disabled={busy} className="btn-ghost ring-1 ring-slate-200 dark:ring-white/10">Пропустить</button>
              <button onClick={removeOp} disabled={busy} className="ml-auto rounded-full px-4 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40">Удалить</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
