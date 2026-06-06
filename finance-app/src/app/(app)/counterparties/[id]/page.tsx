import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney, formatDate } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";
import { COUNTERPARTY_KIND_LABELS } from "@/lib/constants";
import EditCounterpartyForm from "@/components/EditCounterpartyForm";
import AgentCommissionRules, { type Rule } from "@/components/AgentCommissionRules";

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
    .select("id, name, kind, inn, kpp, contact_person, phone, email, note, agent_id")
    .eq("id", id)
    .maybeSingle();

  if (!cp) notFound();

  // Агенты (для выбора у клиента) и доходные статьи + правила/клиенты (для карточки агента)
  const isAgent = cp.kind === "agent";
  const [{ data: agents }, { data: incomeCats }, { data: rules }, { data: referredClients }, { data: agentCp }] = await Promise.all([
    supabase.from("counterparties").select("id, name").eq("team_id", team.id).eq("kind", "agent").eq("archived", false).neq("id", id).order("name"),
    isAgent ? supabase.from("categories").select("id, name").eq("team_id", team.id).eq("kind", "income").eq("archived", false).order("name") : Promise.resolve({ data: [] }),
    isAgent ? supabase.from("agent_commission_rules").select("id, category_id, percent").eq("agent_id", id) : Promise.resolve({ data: [] }),
    isAgent ? supabase.from("counterparties").select("id, name").eq("team_id", team.id).eq("agent_id", id).eq("archived", false).order("name") : Promise.resolve({ data: [] }),
    cp.agent_id ? supabase.from("counterparties").select("id, name").eq("id", cp.agent_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const agentName = (agentCp as { name: string } | null)?.name ?? null;

  const [{ data: txs }, { data: obls }, { data: fxRows }] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, type, amount, currency, occurred_on, category:categories(name), project:projects(name)")
      .eq("team_id", team.id)
      .eq("counterparty_id", id)
      .eq("status", "actual")
      .order("occurred_on", { ascending: false })
      .limit(50),
    supabase
      .from("obligation_balances")
      .select("id, type, amount, currency, outstanding, due_date")
      .eq("team_id", team.id)
      .eq("counterparty_id", id),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  const rates = buildRateMap(fxRows ?? [], base);
  const rows = (txs ?? []) as unknown as {
    id: string;
    type: "income" | "expense" | "transfer";
    amount: number;
    currency: string;
    occurred_on: string;
    category: { name: string } | null;
    project: { name: string } | null;
  }[];

  let income = 0;
  let expense = 0;
  for (const t of rows) {
    const v = toBase(t.amount, t.currency, rates);
    if (t.type === "income") income += v;
    else if (t.type === "expense") expense += v;
  }

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
      <header className="mb-6 mt-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {cp.name}
        </h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          {COUNTERPARTY_KIND_LABELS[cp.kind] ?? cp.kind}
          {agentName && <> · агент: <b>{agentName}</b></>}
        </p>
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
          </dl>
          {manage && (
            <EditCounterpartyForm
              agents={agents ?? []}
              initial={{
                id: cp.id,
                name: cp.name ?? "",
                kind: cp.kind ?? "client",
                inn: cp.inn ?? "",
                kpp: cp.kpp ?? "",
                contact_person: cp.contact_person ?? "",
                phone: cp.phone ?? "",
                email: cp.email ?? "",
                note: cp.note ?? "",
                agent_id: cp.agent_id ?? "",
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

      {/* Агент: ставки комиссии и клиенты */}
      {isAgent && (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
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
        {rows.length > 0 ? (
          <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
            <table className="w-full text-sm">
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-500 dark:text-neutral-400">
                      {formatDate(t.occurred_on)}
                    </td>
                    <td className="px-5 py-3 text-slate-700 dark:text-neutral-300">
                      {t.category?.name ?? (t.type === "transfer" ? "Перевод" : "—")}
                      {t.project?.name && <span className="ml-2 text-xs text-slate-400">· {t.project.name}</span>}
                    </td>
                    <td className={`px-5 py-3 text-right font-semibold ${
                      t.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                    }`}>
                      {t.type === "income" ? "+" : "−"}
                      {formatMoney(t.amount, t.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
