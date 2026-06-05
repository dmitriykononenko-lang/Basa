import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canWriteTx, canEditFinance } from "@/lib/team";
import AddTransactionForm from "@/components/AddTransactionForm";
import ImportTransactions from "@/components/ImportTransactions";
import EditableTransactionRow, { type TxData } from "@/components/EditableTransactionRow";

type TxRow = {
  id: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  occurred_on: string;
  note: string | null;
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

export default async function TransactionsPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Операции
        </h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const { team, role } = current;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: txs }, { data: accounts }, { data: categories }, { data: counterparties }, { data: projects }, { data: employees }] =
    await Promise.all([
      supabase
        .from("transactions")
        .select(
          `id, type, amount, currency, occurred_on, note,
           account_id, transfer_account_id, category_id, counterparty_id, project_id, created_by,
           account:accounts!transactions_account_id_fkey(name),
           to_account:accounts!transactions_transfer_account_id_fkey(name),
           category:categories(name),
           counterparty:counterparties(name),
           project:projects(name)`
        )
        .eq("team_id", team.id)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("accounts").select("id, name, currency").eq("team_id", team.id).eq("archived", false).order("created_at"),
      supabase.from("categories").select("id, name, kind").eq("team_id", team.id).eq("archived", false).order("name"),
      supabase.from("counterparties").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
      supabase.from("projects").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
      supabase.from("employees").select("id, name").eq("team_id", team.id).eq("status", "active").order("name"),
    ]);

  const rows = (txs ?? []) as unknown as TxRow[];
  const writable = canWriteTx(role) && (accounts?.length ?? 0) > 0;
  const cats = (categories ?? []) as { id: string; name: string; kind: "income" | "expense" }[];

  // Вложения по операциям
  const txIds = rows.map((r) => r.id);
  const { data: atts } = txIds.length
    ? await supabase
        .from("attachments")
        .select("id, transaction_id, storage_path, file_name")
        .in("transaction_id", txIds)
    : { data: [] };
  const attByTx = new Map<string, { id: string; storage_path: string; file_name: string }[]>();
  for (const a of atts ?? []) {
    const arr = attByTx.get(a.transaction_id) ?? [];
    arr.push({ id: a.id, storage_path: a.storage_path, file_name: a.file_name });
    attByTx.set(a.transaction_id, arr);
  }

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Операции
          </h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Доходы, расходы и переводы команды «{team.name}»
          </p>
        </div>
        {writable && user && (
          <ImportTransactions
            teamId={team.id}
            userId={user.id}
            accounts={accounts ?? []}
            categories={cats}
            counterparties={counterparties ?? []}
            projects={projects ?? []}
          />
        )}
      </header>

      {writable && user && (
        <div className="mb-6">
          <AddTransactionForm
            teamId={team.id}
            userId={user.id}
            accounts={accounts ?? []}
            categories={cats}
            counterparties={counterparties ?? []}
            projects={projects ?? []}
            employees={employees ?? []}
          />
        </div>
      )}

      {!writable && canWriteTx(role) && (
        <p className="mb-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          Сначала добавьте хотя бы один счёт в разделе «Счета».
        </p>
      )}

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                <th className="px-5 py-3 font-medium">Дата</th>
                <th className="px-5 py-3 font-medium">Описание</th>
                <th className="px-5 py-3 font-medium">Счёт</th>
                <th className="px-5 py-3 text-right font-medium">Сумма</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const editable =
                  canEditFinance(role) ||
                  (role === "employee" && t.created_by === user?.id);
                const data: TxData = {
                  id: t.id,
                  type: t.type,
                  amount: t.amount,
                  currency: t.currency,
                  occurred_on: t.occurred_on,
                  note: t.note,
                  account_id: t.account_id,
                  transfer_account_id: t.transfer_account_id,
                  category_id: t.category_id,
                  counterparty_id: t.counterparty_id,
                  project_id: t.project_id,
                  accountName: t.account?.name ?? null,
                  toAccountName: t.to_account?.name ?? null,
                  categoryName: t.category?.name ?? null,
                  counterpartyName: t.counterparty?.name ?? null,
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
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Операций пока нет.
        </p>
      )}
    </div>
  );
}
