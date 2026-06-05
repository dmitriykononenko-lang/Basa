import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canWriteTx } from "@/lib/team";
import { formatMoney, formatDate } from "@/lib/format";
import AddTransactionForm from "@/components/AddTransactionForm";

type TxRow = {
  id: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  occurred_on: string;
  note: string | null;
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
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-slate-900">Операции</h1>
        <p className="mt-4 text-sm text-slate-500">
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

  const [{ data: txs }, { data: accounts }, { data: categories }, { data: counterparties }, { data: projects }] =
    await Promise.all([
      supabase
        .from("transactions")
        .select(
          `id, type, amount, currency, occurred_on, note,
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
      supabase
        .from("accounts")
        .select("id, name, currency")
        .eq("team_id", team.id)
        .eq("archived", false)
        .order("created_at"),
      supabase
        .from("categories")
        .select("id, name, kind")
        .eq("team_id", team.id)
        .eq("archived", false)
        .order("name"),
      supabase
        .from("counterparties")
        .select("id, name")
        .eq("team_id", team.id)
        .eq("archived", false)
        .order("name"),
      supabase
        .from("projects")
        .select("id, name")
        .eq("team_id", team.id)
        .eq("archived", false)
        .order("name"),
    ]);

  const rows = (txs ?? []) as unknown as TxRow[];
  const writable = canWriteTx(role) && (accounts?.length ?? 0) > 0;

  return (
    <div className="p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Операции</h1>
          <p className="text-sm text-slate-500">
            Доходы, расходы и переводы команды «{team.name}»
          </p>
        </div>
      </header>

      {writable && user && (
        <div className="mb-6">
          <AddTransactionForm
            teamId={team.id}
            userId={user.id}
            accounts={accounts ?? []}
            categories={(categories ?? []) as { id: string; name: string; kind: "income" | "expense" }[]}
            counterparties={counterparties ?? []}
            projects={projects ?? []}
          />
        </div>
      )}

      {!writable && canWriteTx(role) && (
        <p className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Сначала добавьте хотя бы один счёт в разделе «Счета».
        </p>
      )}

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-medium">Дата</th>
                <th className="px-5 py-3 font-medium">Описание</th>
                <th className="px-5 py-3 font-medium">Счёт</th>
                <th className="px-5 py-3 text-right font-medium">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500">
                    {formatDate(t.occurred_on)}
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-800">
                      {t.type === "transfer"
                        ? "Перевод"
                        : t.category?.name ?? "Без категории"}
                    </div>
                    <div className="text-xs text-slate-400">
                      {[t.counterparty?.name, t.project?.name, t.note]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {t.type === "transfer"
                      ? `${t.account?.name} → ${t.to_account?.name}`
                      : t.account?.name}
                  </td>
                  <td
                    className={`whitespace-nowrap px-5 py-3 text-right font-semibold ${
                      t.type === "income"
                        ? "text-emerald-600"
                        : t.type === "expense"
                          ? "text-red-600"
                          : "text-slate-600"
                    }`}
                  >
                    {t.type === "income" ? "+" : t.type === "expense" ? "−" : ""}
                    {formatMoney(t.amount, t.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200">
          Операций пока нет.
        </p>
      )}
    </div>
  );
}
