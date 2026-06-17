"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import { toBase, type RateMap } from "@/lib/fx";
import { toast } from "@/lib/toast";
import { type Attachment } from "@/components/Attachments";
import SplitTransactionModal from "@/components/SplitTransactionModal";
import OperationCard from "@/components/OperationCard";

type Account = { id: string; name: string; currency: string };
type Named = { id: string; name: string; inn?: string | null };
type Category = { id: string; name: string; kind: "income" | "expense" };

export type TxData = {
  id: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  occurred_on: string;
  accrual_date: string | null;
  note: string | null;
  status: string;
  account_id: string | null;
  transfer_account_id: string | null;
  category_id: string | null;
  counterparty_id: string | null;
  project_id: string | null;
  import_batch_id?: string | null;
  accountName: string | null;
  toAccountName: string | null;
  categoryName: string | null;
  counterpartyName: string | null;
  projectName: string | null;
};

export default function EditableTransactionRow({
  tx,
  editable,
  teamId,
  userId,
  attachments,
  accounts,
  categories,
  counterparties,
  projects,
  selected = false,
  onToggle,
  displayBase,
  rates,
}: {
  tx: TxData;
  editable: boolean;
  teamId: string;
  userId: string;
  attachments: Attachment[];
  accounts: Account[];
  categories: Category[];
  counterparties: Named[];
  projects: Named[];
  selected?: boolean;
  onToggle?: () => void;
  // Когда заданы — суммы в иной валюте показываются в базовой (для единообразия, напр. в drilldown ДДС).
  displayBase?: string;
  rates?: RateMap;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [busy, setBusy] = useState(false);

  const isTransfer = tx.type === "transfer";

  async function confirmPlanned() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("transactions")
      .update({ status: "actual", occurred_on: new Date().toISOString().slice(0, 10) })
      .eq("id", tx.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Операция проведена");
    router.refresh();
  }

  async function remove() {
    if (!confirm("Удалить операцию?")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("transactions").delete().eq("id", tx.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Операция удалена");
    router.refresh();
  }

  const converted =
    displayBase && rates && tx.currency !== displayBase
      ? toBase(tx.amount, tx.currency, rates)
      : null;
  const sign = tx.type === "income" ? "+" : tx.type === "expense" ? "−" : "";
  const amountColor =
    tx.type === "income"
      ? "text-emerald-600 dark:text-emerald-400"
      : tx.type === "expense"
        ? "text-red-600 dark:text-red-400"
        : "text-slate-600 dark:text-neutral-300";

  return (
    <tr
      onClick={() => setOpen(true)}
      className={`border-b border-slate-50 last:border-0 dark:border-white/[0.05] ${selected ? "bg-brand/5" : ""} cursor-pointer hover:bg-slate-50/70 dark:hover:bg-white/[0.02]`}
    >
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        {onToggle && (
          <input type="checkbox" checked={selected} onChange={onToggle} className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" />
        )}
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-slate-500 dark:text-neutral-400">
        <span className="inline-flex items-center gap-1">
          {tx.status === "planned" && <span title="Плановая" className="text-violet-500">🕒</span>}
          {formatDate(tx.occurred_on)}
        </span>
        {tx.accrual_date && tx.accrual_date !== tx.occurred_on && (
          <div className="text-[11px] text-violet-500/80" title="Дата начисления (учитывается в ОПиУ)">
            начислено: {formatDate(tx.accrual_date)}
          </div>
        )}
      </td>
      <td className={`whitespace-nowrap px-5 py-3 font-semibold ${amountColor}`}>
        {sign}
        {converted != null ? (
          <>
            {formatMoney(converted, displayBase!)}
            <span className="ml-1 text-[11px] font-normal text-slate-400">
              ({formatMoney(tx.amount, tx.currency)})
            </span>
          </>
        ) : (
          formatMoney(tx.amount, tx.currency)
        )}
      </td>
      <td className="px-5 py-3">
        <div className="font-medium text-slate-800 dark:text-neutral-200">
          {isTransfer ? "Перевод" : tx.categoryName ?? "Без статьи"}
        </div>
        {(tx.note || attachments.length > 0) && (
          <div className="max-w-xs truncate text-xs text-slate-400 dark:text-neutral-500">
            {tx.note}
            {attachments.length > 0 && <span className="ml-1">📎 {attachments.length}</span>}
          </div>
        )}
      </td>
      <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{tx.projectName ?? "—"}</td>
      <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{tx.counterpartyName ?? "—"}</td>
      <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">
        {isTransfer ? `${tx.accountName} → ${tx.toAccountName}` : tx.accountName}
      </td>
      <td className="px-3 py-3 text-right">
        {editable && (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {tx.status === "planned" && (
              <button
                onClick={confirmPlanned}
                disabled={busy}
                className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                Провести
              </button>
            )}
            {!isTransfer && (
              <button
                onClick={() => setSplitting(true)}
                className="rounded-full px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                title="Разбить на несколько операций"
              >
                Разбить
              </button>
            )}
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-full px-2 py-1 text-xs text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              Удалить
            </button>
          </div>
        )}
        {splitting && (
          <SplitTransactionModal
            open={splitting}
            onClose={() => setSplitting(false)}
            tx={tx}
            categories={categories}
            counterparties={counterparties}
            projects={projects}
            teamId={teamId}
            userId={userId}
            hasAttachments={attachments.length > 0}
          />
        )}
        {open && (
          <OperationCard
            open={open}
            onClose={() => setOpen(false)}
            tx={tx}
            teamId={teamId}
            userId={userId}
            accounts={accounts}
            categories={categories}
            counterparties={counterparties}
            projects={projects}
            attachments={attachments}
            canEdit={editable}
          />
        )}
      </td>
    </tr>
  );
}
