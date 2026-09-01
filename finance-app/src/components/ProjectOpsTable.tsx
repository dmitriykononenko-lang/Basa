"use client";

import { useState } from "react";
import { formatDate, formatMoney } from "@/lib/format";
import OperationCard from "@/components/OperationCard";
import type { TxData } from "@/components/EditableTransactionRow";

type Account = { id: string; name: string; currency: string };
type Named = { id: string; name: string; inn?: string | null };
type Category = { id: string; name: string; kind: "income" | "expense" };

export default function ProjectOpsTable({
  items, accounts, categories, counterparties, projects, teamId, userId, canEdit,
}: {
  items: TxData[];
  accounts: Account[];
  categories: Category[];
  counterparties: Named[];
  projects: Named[];
  teamId: string;
  userId: string;
  canEdit: boolean;
}) {
  const [active, setActive] = useState<TxData | null>(null);

  return (
    <>
      <table className="w-full text-sm">
        <tbody>
          {items.slice(0, 30).map((t) => (
            <tr
              key={t.id}
              onClick={() => setActive(t)}
              className="cursor-pointer border-b border-slate-50 transition last:border-0 hover:bg-slate-50 dark:border-white/[0.05] dark:hover:bg-white/[0.03]"
            >
              <td className="whitespace-nowrap px-5 py-3 text-slate-500 dark:text-neutral-400">{formatDate(t.occurred_on)}</td>
              <td className="px-5 py-3 text-slate-700 dark:text-neutral-300">
                {t.categoryName ?? "—"}
                {t.counterpartyName && <span className="ml-2 text-xs text-slate-400">· {t.counterpartyName}</span>}
              </td>
              <td className={`px-5 py-3 text-right font-semibold ${
                t.type === "income" ? "text-emerald-600 dark:text-emerald-400" : t.type === "expense" ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-neutral-300"
              }`}>
                {t.type === "income" ? "+" : t.type === "expense" ? "−" : ""}{formatMoney(t.amount, t.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {active && (
        <OperationCard
          open
          onClose={() => setActive(null)}
          tx={active}
          teamId={teamId}
          userId={userId}
          accounts={accounts}
          categories={categories}
          counterparties={counterparties}
          projects={projects}
          attachments={[]}
          canEdit={canEdit}
        />
      )}
    </>
  );
}
