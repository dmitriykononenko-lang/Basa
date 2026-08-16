"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import { toBase, type RateMap } from "@/lib/fx";
import { toast } from "@/lib/toast";
import { type Attachment } from "@/components/Attachments";
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
  transfer_amount: number | null;
  transfer_currency: string | null;
  category_id: string | null;
  counterparty_id: string | null;
  project_id: string | null;
  import_batch_id?: string | null;
  accountName: string | null;
  toAccountName: string | null;
  categoryName: string | null;
  counterpartyName: string | null;
  projectName: string | null;
  splitCount?: number; // число частей операции (внутренний split), если разбита
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

  const converted =
    displayBase && rates && tx.currency !== displayBase
      ? toBase(tx.amount, tx.currency, rates)
      : null;
  const sign = tx.type === "income" ? "+" : tx.type === "expense" ? "−" : "";
  const arrow = tx.type === "income" ? "↗" : tx.type === "expense" ? "↘" : "";
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
        {arrow && <span className="mr-1 font-normal">{arrow}</span>}
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
        {isTransfer && tx.transfer_amount != null && tx.transfer_currency && tx.transfer_currency !== tx.currency && (
          <div className="text-[11px] font-normal text-emerald-600/90 dark:text-emerald-400/90" title="Сумма зачисления">
            → {formatMoney(tx.transfer_amount, tx.transfer_currency)}
          </div>
        )}
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-neutral-200">
          {isTransfer ? "Перевод" : (tx.splitCount && tx.splitCount >= 2 ? `${tx.splitCount} части` : (tx.categoryName ?? "Без статьи"))}
          {!isTransfer && tx.splitCount && tx.splitCount >= 2 && (
            <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">split</span>
          )}
        </div>
        {(tx.note || attachments.length > 0) && (
          <div className="max-w-xs truncate text-xs text-slate-400 dark:text-neutral-500">
            {tx.note}
            {attachments.length > 0 && <span className="ml-1">📎 {attachments.length}</span>}
          </div>
        )}
      </td>
      <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">
        {tx.projectName ? (
          tx.project_id ? (
            <Link
              href={`/projects/${tx.project_id}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-block max-w-[170px] truncate rounded-md bg-slate-100 px-2 py-0.5 align-middle text-xs font-medium text-slate-600 transition hover:bg-slate-200 dark:bg-white/[0.06] dark:text-neutral-300 dark:hover:bg-white/[0.1]"
            >
              {tx.projectName}
            </Link>
          ) : (
            <span className="inline-block max-w-[170px] truncate rounded-md bg-slate-100 px-2 py-0.5 align-middle text-xs font-medium text-slate-600 dark:bg-white/[0.06] dark:text-neutral-300">
              {tx.projectName}
            </span>
          )
        ) : (
          "—"
        )}
      </td>
      <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{tx.counterpartyName ?? "—"}</td>
      <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">
        {tx.accountName ? (
          <span className="inline-flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor(tx.accountName)}`} />
            <span className="truncate">{isTransfer ? `${tx.accountName} → ${tx.toAccountName ?? "—"}` : tx.accountName}</span>
          </span>
        ) : (
          "—"
        )}
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
          </div>
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

// Стабильный цвет точки для счёта/фонда (как разноцветные метки в макете).
const DOT_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-violet-500",
  "bg-rose-500", "bg-cyan-500", "bg-orange-500", "bg-slate-400",
];
function dotColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return DOT_COLORS[h % DOT_COLORS.length];
}
