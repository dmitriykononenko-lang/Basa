import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney, formatDate } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";
import { COUNTERPARTY_KIND_LABELS } from "@/lib/constants";
import EditCounterpartyForm from "@/components/EditCounterpartyForm";
import AgentCommissionRules, { type Rule } from "@/components/AgentCommissionRules";
import AgentPayouts, { type Payout } from "@/components/AgentPayouts";
import OperationsTable from "@/components/OperationsTable";
import type { TxData } from "@/components/EditableTransactionRow";

export default async function CounterpartyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const current = await getCurrentTeam();
  if (!current) notFound();
  const { team, role } = current;
  const manage = canEditFinance(role);
  const base = team.base_currency;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: cp } = await supabase
    .from("counterparties")
    .select("id, name, kind, kinds, inn, kpp, contact_person, phone, email, note, agent_id, contract_number, contract_date, payment_method, payee_name, legal_status, bank_account, bank_name, bik, wallet_address, wallet_network")
    .eq("id", id)
    .maybeSingle();

  if (!cp) notFound();

  const cpKinds: string[] = (cp.kinds && cp.kinds.length ? cp.kinds : (cp.kind ? [cp.kind] : [])) as string[];

  // Агенты (для выбора у клиента) и доходные статьи + правила/клиенты (для карточки агента)
  const isAgent = cpKinds.includes("agent");
  const [{ data: agents }, { data: incomeCats }, { data: rules }, { data: referredClients }, { data: agentCp }] = await Promise.all([
    supabase.from("counterparties").select("id, name").eq("team_id", team.id).contains("kinds", ["agent"]).eq("archived", false).neq("id", id).order("name"),
    isAgent ? supabase.from("categories").select("id, name").eq("team_id", team.id).eq("kind", "income").eq("archived", false).order("name") : Promise.resolve({ data: [] }),
    isAgent ? supabase.from("agent_commission_rules").select("id, category_id, percent").eq("agent_id", id) : Promise.resolve({ data: [] }),
    isAgent ? supabase.from("counterparties").select("id, name").eq("team_id", team.id).eq("agent_id", id).eq("archived", false).order("name") : Promise.resolve({ data: [] }),
    cp.agent_id ? supabase.from("counterparties").select("id, name").eq("id", cp.agent_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const agentName = (agentCp as { name: string } | null)?.name ?? null;

  // Агентские выплаты (комиссии с привязкой к приходу)
  let payouts: Payout[] = [];
  let payoutAccounts: { id: string; name: string; currency: string }[] = [];
  if (isAgent) {
    const [{ data: comm }, { data: accs }] = await Promise.all([
      supabase
        .from("obligations")
        .select("id, amount, currency, source_transaction_id, source:transactions!obligations_source_transaction_id_fkey(occurred_on, amount, counterparty:counterparties(name))")
        .eq("team_id", team.id).eq("counterparty_id", id).eq("type", "payable").not("source_transaction_id", "is", null)
        .order("created_at", { ascending: false }),
      supabase.from("accounts").select("id, name, currency").eq("team_id", team.id).eq("archived", false).order("created_at"),
    ]);
    payoutAccounts = accs ?? [];
    const commRows = (comm ?? []) as unknown as {
      id: string; amount: number; currency: string;
      source: { occurred_on: string; amount: number; counterparty: { name: string } | null } | null;
    }[];
    const oblIds = commRows.map((o) => o.id);
    const { data: pays } = oblIds.length
      ? await supabase.from("obligation_payments").select("obligation_id, amount").in("obligation_id", oblIds)
      : { data: [] as { obligation_id: string; amount: number }[] };
    const paidBy = new Map<string, number>();
    for (const p of pays ?? []) paidBy.set(p.obligation_id, (paidBy.get(p.obligation_id) ?? 0) + p.amount);
    payouts = commRows.map((o) => {
      const base = o.source?.amount ?? 0;
      const paid = paidBy.get(o.id) ?? 0;
      return {
        id: o.id,
        clientName: o.source?.counterparty?.name ?? "—",
        sourceDate: o.source?.occurred_on ?? null,
        base, commission: o.amount, currency: o.currency,
        percent: base > 0 ? Math.round((o.amount / base) * 1000) / 10 : 0,
        paid, outstanding: o.amount - paid,
      };
    });
  }

  const [{ data: txs }, { data: obls }, { data: fxRows }, { data: opAccounts }, { data: opCats }, { data: opProjects }, { data: opCps }] = await Promise.all([
    supabase
      .from("transactions")
      .select(`id, type, amount, currency, occurred_on, accrual_date, note, status,
        account_id, transfer_account_id, category_id, counterparty_id, project_id, import_batch_id,
        account:accounts!transactions_account_id_fkey(name),
        to_account:accounts!transactions_transfer_account_id_fkey(name),
        category:categories(name), counterparty:counterparties(name), project:projects(name)`)
      .eq("team_id", team.id)
      .eq("counterparty_id", id)
      .eq("status", "actual")
      .order("occurred_on", { ascending: false })
      .limit(100),
    supabase
      .from("obligation_balances")
      .select("id, type, amount, currency, outstanding, due_date")
      .eq("team_id", team.id)
      .eq("counterparty_id", id),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
    supabase.from("accounts").select("id, name, currency").eq("team_id", team.id).eq("archived", false).order("created_at"),
    supabase.from("categories").select("id, name, kind").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("projects").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("counterparties").select("id, name, inn").eq("team_id", team.id).eq("archived", false).order("name"),
  ]);

  const rates = buildRateMap(fxRows ?? [], base);
  const txRows = (txs ?? []) as unknown as {
    id: string; type: "income" | "expense" | "transfer"; amount: number; currency: string;
    occurred_on: string; accrual_date: string | null; note: string | null; status: string;
    account_id: string | null; transfer_account_id: string | null; category_id: string | null;
    counterparty_id: string | null; project_id: string | null; import_batch_id: string | null;
    account: { name: string } | null; to_account: { name: string } | null;
    category: { name: string } | null; counterparty: { name: string } | null; project: { name: string } | null;
  }[];

  let income = 0;
  let expense = 0;
  for (const t of txRows) {
    const v = toBase(t.amount, t.currency, rates);
    if (t.type === "income") income += v;
    else if (t.type === "expense") expense += v;
  }

  const opItems = txRows.map((t) => ({
    editable: manage,
    attachments: [] as [],
    tx: {
      id: t.id, type: t.type, amount: t.amount, currency: t.currency, occurred_on: t.occurred_on,
      accrual_date: t.accrual_date, note: t.note, status: t.status, account_id: t.account_id,
      transfer_account_id: t.transfer_account_id, category_id: t.category_id, counterparty_id: t.counterparty_id,
      project_id: t.project_id, import_batch_id: t.import_batch_id,
      accountName: t.account?.name ?? null, toAccountName: t.to_account?.name ?? null,
      categoryName: t.category?.name ?? null, counterpartyName: t.counterparty?.name ?? null,
      projectName: t.project?.name ?? null,
    } as TxData,
  }));

  let receivable = 0;
  let payable = 0;
  for (const o of obls ?? []) {
    if (o.outstanding <= 0) continue;
    const v = toBase(o.outstanding, o.currency, rates);
    if (o.type === "receivable") receivable += v;
    else payable += v;
  }

  return (
    <div className="p-6 sm:p-8">
      <Link href="/counterparties" className="text-sm text-slate-400 hover:text-brand">
        ← Контрагенты
      </Link>
      <header className="mb-6 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {cp.name}
        </h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          {cpKinds.map((k) => COUNTERPARTY_KIND_LABELS[k] ?? k).join(" · ") || "—"}
          {agentName && <> · агент: <b>{agentName}</b></>}
          {cp.contract_number && <> · договор № {cp.contract_number}{cp.contract_date && ` от ${formatDate(cp.contract_date)}`}</>}
        </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Реквизиты */}
        <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
            Реквизиты
          </h2>
          <dl className="space-y-2 text-sm">
            <Info label="ИНН" value={cp.inn} />
            <Info label="КПП" value={cp.kpp} />
            <Info label="Контактное лицо" value={cp.contact_person} />
            <Info label="Телефон" value={cp.phone} />
            <Info label="Email" value={cp.email} />
            <Info label="Заметка" value={cp.note} />
            {(cp.bank_account || cp.payee_name || cp.wallet_address) && (
              <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 dark:border-white/[0.06]">
                {cp.payment_method === "crypto" ? (
                  <>
                    <Info label="Кошелёк" value={cp.wallet_address} />
                    <Info label="Сеть" value={cp.wallet_network} />
                  </>
                ) : (
                  <>
                    <Info label="Получатель" value={cp.payee_name} />
                    <Info label="Р/С" value={cp.bank_account} />
                    <Info label="Банк" value={cp.bank_name} />
                    <Info label="БИК" value={cp.bik} />
                  </>
                )}
              </div>
            )}
          </dl>
          {manage && (
            <EditCounterpartyForm
              agents={agents ?? []}
              initial={{
                id: cp.id,
                name: cp.name ?? "",
                kind: cp.kind ?? "client",
                kinds: cpKinds,
                inn: cp.inn ?? "",
                kpp: cp.kpp ?? "",
                contact_person: cp.contact_person ?? "",
                phone: cp.phone ?? "",
                email: cp.email ?? "",
                note: cp.note ?? "",
                agent_id: cp.agent_id ?? "",
                contract_number: cp.contract_number ?? "",
                contract_date: cp.contract_date ?? "",
              }}
            />
          )}
        </div>

        {/* Сводка */}
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <Stat title="Поступления" value={formatMoney(income, base)} accent="emerald" />
          <Stat title="Платежи" value={formatMoney(expense, base)} accent="red" />
          <Stat title="Нам должны" value={formatMoney(receivable, base)} accent="emerald" />
          <Stat title="Мы должны" value={formatMoney(payable, base)} accent="red" />
        </div>
      </div>

      {/* Агент: выплаты, ставки комиссии и клиенты */}
      {isAgent && user && (
        <div className="mt-6">
          <AgentPayouts teamId={team.id} userId={user.id} agentId={cp.id} accounts={payoutAccounts} payouts={payouts} />
        </div>
      )}
      {isAgent && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {manage && user ? (
            <AgentCommissionRules
              teamId={team.id}
              userId={user.id}
              agentId={cp.id}
              rules={(rules ?? []) as Rule[]}
              incomeCategories={(incomeCats ?? []) as { id: string; name: string }[]}
            />
          ) : <div />}
          <section className="rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
              Клиенты от агента
            </h2>
            {(referredClients ?? []).length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {(referredClients ?? []).map((rc) => (
                  <li key={rc.id}>
                    <Link href={`/counterparties/${rc.id}`} className="text-slate-700 hover:text-brand dark:text-neutral-300">{rc.name}</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">Пока нет клиентов, привязанных к этому агенту.</p>
            )}
          </section>
        </div>
      )}

      {/* Операции */}
      <section className="mt-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
          Операции
        </h2>
        {opItems.length > 0 ? (
          <OperationsTable
            items={opItems}
            accounts={opAccounts ?? []}
            categories={(opCats ?? []) as { id: string; name: string; kind: "income" | "expense" }[]}
            counterparties={opCps ?? []}
            projects={opProjects ?? []}
            teamId={team.id}
            userId={user?.id ?? ""}
          />
        ) : (
          <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
            Операций с этим контрагентом пока нет.
          </p>
        )}
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-400 dark:text-neutral-500">{label}</dt>
      <dd className="text-right font-medium text-slate-700 dark:text-neutral-200">{value || "—"}</dd>
    </div>
  );
}

function Stat({ title, value, accent }: { title: string; value: string; accent: "emerald" | "red" }) {
  const map = { emerald: "text-emerald-600 dark:text-emerald-400", red: "text-red-600 dark:text-red-400" };
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
      <div className={`mt-2 text-xl font-bold ${map[accent]}`}>{value}</div>
    </div>
  );
}
