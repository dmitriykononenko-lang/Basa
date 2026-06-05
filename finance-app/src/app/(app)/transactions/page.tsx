import { Fragment } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canWriteTx, canEditFinance } from "@/lib/team";
import { formatDate } from "@/lib/format";
import AddTransactionForm from "@/components/AddTransactionForm";
import ImportTransactions from "@/components/ImportTransactions";
import TransactionsFilter from "@/components/TransactionsFilter";
import ExportButton from "@/components/ExportButton";
import EditableTransactionRow, { type TxData } from "@/components/EditableTransactionRow";

type TxRow = {
  id: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  occurred_on: string;
  note: string | null;
  status: string;
  account_id: string | null;
  transfer_account_id: string | null;
  category_id: string | null;
  counterparty_id: string | null;
  project_id: string | null;
  created_by: string | null;
  account: { name: string } | null;
  to_account: { name: string } | null;
  category: { name: string } | null;
  counterparty: { name: string } | null;
  project: { name: string } | null;
};

function periodStart(period: string): string | null {
  const now = new Date();
  if (period === "quarter") return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().slice(0, 10);
  if (period === "year") return new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
  if (period === "all") return null;
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10); // month
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const period = sp.period ?? "month";
  const fType = sp.type ?? "all";
  const fStatus = sp.status ?? "all";
  const fAccount = sp.account ?? "all";
  const fProject = sp.project ?? "all";
  const fCp = sp.counterparty ?? "all";
  const fCat = sp.category ?? "all";
  const q = sp.q ?? "";

  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Операции</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }

  const { team, role } = current;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: accounts }, { data: categories }, { data: counterparties }, { data: projects }] = await Promise.all([
    supabase.from("accounts").select("id, name, currency").eq("team_id", team.id).eq("archived", false).order("created_at"),
    supabase.from("categories").select("id, name, kind").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("counterparties").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("projects").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
  ]);

  let query = supabase
    .from("transactions")
    .select(
      `id, type, amount, currency, occurred_on, note, status,
       account_id, transfer_account_id, category_id, counterparty_id, project_id, created_by,
       account:accounts!transactions_account_id_fkey(name),
       to_account:accounts!transactions_transfer_account_id_fkey(name),
       category:categories(name),
       counterparty:counterparties(name),
       project:projects(name)`
    )
    .eq("team_id", team.id);

  const start = periodStart(period);
  if (start) query = query.gte("occurred_on", start);
  if (fType !== "all") query = query.eq("type", fType);
  if (fStatus !== "all") query = query.eq("status", fStatus);
  if (fAccount !== "all") query = query.or(`account_id.eq.${fAccount},transfer_account_id.eq.${fAccount}`);
  if (fProject !== "all") query = query.eq("project_id", fProject);
  if (fCp !== "all") query = query.eq("counterparty_id", fCp);
  if (fCat !== "all") query = query.eq("category_id", fCat);
  if (q) query = query.ilike("note", `%${q}%`);
  query = query.order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(300);

  const { data: txs } = await query;
  const rows = (txs ?? []) as unknown as TxRow[];
  const writable = canWriteTx(role) && (accounts?.length ?? 0) > 0;
  const cats = (categories ?? []) as { id: string; name: string; kind: "income" | "expense" }[];

  // Вложения
  const txIds = rows.map((r) => r.id);
  const { data: atts } = txIds.length
    ? await supabase.from("attachments").select("id, transaction_id, storage_path, file_name").in("transaction_id", txIds)
    : { data: [] };
  const attByTx = new Map<string, { id: string; storage_path: string; file_name: string }[]>();
  for (const a of atts ?? []) {
    const arr = attByTx.get(a.transaction_id) ?? [];
    arr.push({ id: a.id, storage_path: a.storage_path, file_name: a.file_name });
    attByTx.set(a.transaction_id, arr);
  }

  // Группировка по дате
  const groups: { date: string; rows: TxRow[] }[] = [];
  for (const t of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.occurred_on) last.rows.push(t);
    else groups.push({ date: t.occurred_on, rows: [t] });
  }
  const today = new Date().toISOString().slice(0, 10);

  const exportRows = rows.map((t) => [
    t.occurred_on,
    t.type === "income" ? "Приход" : t.type === "expense" ? "Расход" : "Перевод",
    (t.amount / 100).toFixed(2).replace(".", ","),
    t.currency,
    t.category?.name ?? "",
    t.project?.name ?? "",
    t.counterparty?.name ?? "",
    t.account?.name ?? "",
    t.status === "planned" ? "План" : "Факт",
    t.note ?? "",
  ]);

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Операции</h1>
        <div className="flex items-center gap-2">
          <ExportButton
            headers={["Дата", "Тип", "Сумма", "Валюта", "Статья", "Проект", "Контрагент", "Счёт", "Статус", "Комментарий"]}
            rows={exportRows}
            filename={`operations-${period}.csv`}
          />
          {writable && user && (
            <ImportTransactions teamId={team.id} userId={user.id} accounts={accounts ?? []} categories={cats} counterparties={counterparties ?? []} projects={projects ?? []} />
          )}
        </div>
      </header>

      {writable && user && (
        <div className="mb-5">
          <AddTransactionForm teamId={team.id} userId={user.id} accounts={accounts ?? []} categories={cats} counterparties={counterparties ?? []} projects={projects ?? []} />
        </div>
      )}

      {!writable && canWriteTx(role) && (
        <p className="mb-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          Сначала добавьте хотя бы один счёт в разделе «Счета».
        </p>
      )}

      <TransactionsFilter
        accounts={accounts ?? []}
        projects={projects ?? []}
        counterparties={counterparties ?? []}
        categories={(categories ?? []).map((c) => ({ id: c.id, name: c.name }))}
      />

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                <th className="px-5 py-3 font-medium">Дата</th>
                <th className="px-5 py-3 font-medium">Операция</th>
                <th className="px-5 py-3 font-medium">Статья / Описание</th>
                <th className="px-5 py-3 font-medium">Проект</th>
                <th className="px-5 py-3 font-medium">Контрагент</th>
                <th className="px-5 py-3 font-medium">Счёт</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.date}>
                  <tr className="bg-slate-50/70 dark:bg-white/[0.03]">
                    <td colSpan={7} className="px-5 py-2 text-xs font-semibold text-slate-500 dark:text-neutral-400">
                      {g.date === today ? "Сегодня" : formatDate(g.date)}
                    </td>
                  </tr>
                  {g.rows.map((t) => {
                    const editable = canEditFinance(role) || (role === "employee" && t.created_by === user?.id);
                    const data: TxData = {
                      id: t.id, type: t.type, amount: t.amount, currency: t.currency, occurred_on: t.occurred_on,
                      note: t.note, status: t.status, account_id: t.account_id, transfer_account_id: t.transfer_account_id,
                      category_id: t.category_id, counterparty_id: t.counterparty_id, project_id: t.project_id,
                      accountName: t.account?.name ?? null, toAccountName: t.to_account?.name ?? null,
                      categoryName: t.category?.name ?? null, counterpartyName: t.counterparty?.name ?? null,
                      projectName: t.project?.name ?? null,
                    };
                    return (
                      <EditableTransactionRow
                        key={t.id}
                        tx={data}
                        editable={editable}
                        teamId={team.id}
                        userId={user?.id ?? ""}
                        attachments={attByTx.get(t.id) ?? []}
                        accounts={accounts ?? []}
                        categories={cats}
                        counterparties={counterparties ?? []}
                        projects={projects ?? []}
                      />
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Операций по фильтру нет.
        </p>
      )}
    </div>
  );
}
