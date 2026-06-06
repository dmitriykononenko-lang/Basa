"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import OperationsTable from "@/components/OperationsTable";
import type { TxData } from "@/components/EditableTransactionRow";

export type DrillFilter = {
  dateFrom?: string;
  dateTo?: string;
  categoryId?: string;
  projectId?: string;
  counterpartyId?: string;
  type?: "income" | "expense" | "transfer";
  status?: "actual" | "planned";
};

type Account = { id: string; name: string; currency: string };
type Named = { id: string; name: string; inn?: string | null };
type Category = { id: string; name: string; kind: "income" | "expense" };

type TxRow = {
  id: string; type: "income" | "expense" | "transfer"; amount: number; currency: string;
  occurred_on: string; accrual_date: string | null; note: string | null; status: string;
  account_id: string | null; transfer_account_id: string | null; category_id: string | null;
  counterparty_id: string | null; project_id: string | null;
  account: { name: string } | null; to_account: { name: string } | null;
  category: { name: string } | null; counterparty: { name: string } | null; project: { name: string } | null;
};

const SELECT =
  `id, type, amount, currency, occurred_on, accrual_date, note, status,
   account_id, transfer_account_id, category_id, counterparty_id, project_id,
   account:accounts!transactions_account_id_fkey(name),
   to_account:accounts!transactions_transfer_account_id_fkey(name),
   category:categories(name), counterparty:counterparties(name), project:projects(name)`;

export default function DrilldownModal({
  open, onClose, title, filter, teamId, userId, canEdit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  filter: DrillFilter;
  teamId: string;
  userId: string;
  canEdit: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<{ tx: TxData; editable: boolean; attachments: [] }[]>([]);
  const [refs, setRefs] = useState<{ accounts: Account[]; categories: Category[]; counterparties: Named[]; projects: Named[] }>({
    accounts: [], categories: [], counterparties: [], projects: [],
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const supabase = createClient();
      let q = supabase.from("transactions").select(SELECT).eq("team_id", teamId);
      if (filter.dateFrom) q = q.gte("occurred_on", filter.dateFrom);
      if (filter.dateTo) q = q.lte("occurred_on", filter.dateTo);
      if (filter.categoryId) q = q.eq("category_id", filter.categoryId);
      if (filter.projectId) q = q.eq("project_id", filter.projectId);
      if (filter.counterpartyId) q = q.eq("counterparty_id", filter.counterpartyId);
      if (filter.type) q = q.eq("type", filter.type);
      if (filter.status) q = q.eq("status", filter.status);
      q = q.order("occurred_on", { ascending: false }).limit(300);

      const [{ data: txs }, { data: accounts }, { data: categories }, { data: counterparties }, { data: projects }] = await Promise.all([
        q,
        supabase.from("accounts").select("id, name, currency").eq("team_id", teamId).eq("archived", false).order("created_at"),
        supabase.from("categories").select("id, name, kind").eq("team_id", teamId).eq("archived", false).order("name"),
        supabase.from("counterparties").select("id, name, inn").eq("team_id", teamId).eq("archived", false).order("name"),
        supabase.from("projects").select("id, name").eq("team_id", teamId).eq("archived", false).order("name"),
      ]);
      if (cancelled) return;
      const rows = (txs ?? []) as unknown as TxRow[];
      setItems(rows.map((t) => ({
        editable: canEdit,
        attachments: [] as [],
        tx: {
          id: t.id, type: t.type, amount: t.amount, currency: t.currency, occurred_on: t.occurred_on,
          accrual_date: t.accrual_date, note: t.note, status: t.status, account_id: t.account_id, transfer_account_id: t.transfer_account_id,
          category_id: t.category_id, counterparty_id: t.counterparty_id, project_id: t.project_id,
          accountName: t.account?.name ?? null, toAccountName: t.to_account?.name ?? null,
          categoryName: t.category?.name ?? null, counterpartyName: t.counterparty?.name ?? null,
          projectName: t.project?.name ?? null,
        },
      })));
      setRefs({
        accounts: (accounts ?? []) as Account[],
        categories: (categories ?? []) as Category[],
        counterparties: (counterparties ?? []) as Named[],
        projects: (projects ?? []) as Named[],
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, teamId, canEdit, JSON.stringify(filter)]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8" onClick={onClose}>
      <div
        className="w-full max-w-5xl rounded-3xl bg-slate-50 p-5 shadow-2xl dark:bg-[#101116] sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="rounded-full px-2 text-xl text-slate-400 hover:text-slate-700 dark:hover:text-neutral-200">✕</button>
        </div>
        {loading ? (
          <p className="py-10 text-center text-sm text-slate-400">Загружаем операции…</p>
        ) : items.length > 0 ? (
          <OperationsTable
            items={items}
            accounts={refs.accounts}
            categories={refs.categories}
            counterparties={refs.counterparties}
            projects={refs.projects}
            teamId={teamId}
            userId={userId}
          />
        ) : (
          <p className="py-10 text-center text-sm text-slate-400">Операций нет.</p>
        )}
      </div>
    </div>
  );
}
