import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import { formatMoney, formatDate } from "@/lib/format";
import { rublesInWords } from "@/lib/money-words";
import PrintButton from "@/components/PrintButton";

const fmt = (d: Date) => d.toISOString().slice(0, 10);

export default async function AgentReportPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; act?: string }>;
}) {
  const { id } = await params;
  const { from, to, act: actParam } = await searchParams;
  const act = actParam === "1";
  const current = await getCurrentTeam();
  if (!current) notFound();
  const { team } = current;
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from("counterparties")
    .select("id, name, contract_number, contract_date, payee_name, inn, payment_method, bank_account, bank_name, bik, wallet_address, wallet_network, legal_status")
    .eq("id", id)
    .maybeSingle();
  if (!agent) notFound();

  // Реквизиты Принципала (наша компания) — для акта
  const { data: companyRow } = await supabase
    .from("teams").select("legal_name, inn, kpp, ogrn, address").eq("id", team.id).maybeSingle();
  const company = (companyRow ?? null) as { legal_name?: string | null; inn?: string | null; kpp?: string | null; ogrn?: string | null; address?: string | null } | null;
  const principalName = company?.legal_name || team.name;

  const { data: comm } = await supabase
    .from("obligations")
    .select("id, amount, currency, source:transactions!obligations_source_transaction_id_fkey(occurred_on, amount, category:categories(name), counterparty:counterparties(name))")
    .eq("team_id", team.id).eq("counterparty_id", id).eq("type", "payable").not("source_transaction_id", "is", null);

  const commRows = (comm ?? []) as unknown as {
    id: string; amount: number; currency: string;
    source: { occurred_on: string; amount: number; category: { name: string } | null; counterparty: { name: string } | null } | null;
  }[];
  const oblMap = new Map(commRows.map((o) => [o.id, o]));
  const oblIds = commRows.map((o) => o.id);

  // Выплаты за период (для отчёта)
  let payQ = supabase.from("obligation_payments").select("obligation_id, amount, paid_on");
  if (oblIds.length) payQ = payQ.in("obligation_id", oblIds);
  if (from) payQ = payQ.gte("paid_on", from);
  if (to) payQ = payQ.lte("paid_on", to);
  const { data: pays } = (!act && oblIds.length) ? await payQ : { data: [] as { obligation_id: string; amount: number; paid_on: string }[] };

  // Всего выплачено по каждому обязательству (для акта — остаток к выплате)
  const paidByObl = new Map<string, number>();
  if (act && oblIds.length) {
    const { data: allPays } = await supabase.from("obligation_payments").select("obligation_id, amount").in("obligation_id", oblIds);
    for (const p of allPays ?? []) paidByObl.set(p.obligation_id, (paidByObl.get(p.obligation_id) ?? 0) + p.amount);
  }

  const rows = act
    ? commRows
        .map((o) => {
          const base = o.source?.amount ?? 0;
          const outstanding = o.amount - (paidByObl.get(o.id) ?? 0);
          return {
            client: o.source?.counterparty?.name ?? "—",
            category: o.source?.category?.name ?? "Без статьи",
            sourceDate: o.source?.occurred_on ?? null,
            base, currency: o.currency ?? team.base_currency,
            percent: base > 0 ? Math.round((o.amount / base) * 1000) / 10 : 0,
            value: outstanding, paidOn: null as string | null,
          };
        })
        .filter((r) => r.value > 0)
        .sort((a, b) => ((a.sourceDate ?? "") < (b.sourceDate ?? "") ? 1 : -1))
    : (pays ?? [])
        .map((p) => {
          const o = oblMap.get(p.obligation_id);
          const base = o?.source?.amount ?? 0;
          return {
            client: o?.source?.counterparty?.name ?? "—",
            category: o?.source?.category?.name ?? "Без статьи",
            sourceDate: o?.source?.occurred_on ?? null,
            base, currency: o?.currency ?? team.base_currency,
            percent: base > 0 ? Math.round(((o?.amount ?? 0) / base) * 1000) / 10 : 0,
            value: p.amount, paidOn: p.paid_on as string | null,
          };
        })
        .sort((a, b) => ((a.paidOn ?? "") < (b.paidOn ?? "") ? 1 : -1));

  const totalPaid = rows.reduce((s, r) => s + r.value, 0);
  const cur = rows[0]?.currency ?? team.base_currency;
  const valueLabel = act ? "К выплате" : "Выплачено";
  const docTitle = act ? "Акт на выплату агентского вознаграждения" : "Отчёт по агентским выплатам";
  const periodLabel = act
    ? "невыплаченное вознаграждение на сегодня"
    : (from || to ? `за период ${from ? formatDate(from) : "…"} — ${to ? formatDate(to) : "…"}` : "за всё время");

  // Разбивка по статьям
  const byCat = new Map<string, number>();
  for (const r of rows) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.value);
  const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);

  // Пресеты периода
  const now = new Date();
  const presets: { label: string; from?: string; to?: string }[] = [
    { label: "Месяц", from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)) },
    { label: "Квартал", from: fmt(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), to: fmt(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0)) },
    { label: "Год", from: fmt(new Date(now.getFullYear(), 0, 1)), to: fmt(new Date(now.getFullYear(), 11, 31)) },
    { label: "Всё", from: undefined, to: undefined },
  ];
  const isActive = (p: { from?: string; to?: string }) => (p.from ?? "") === (from ?? "") && (p.to ?? "") === (to ?? "");
  const isCrypto = agent.payment_method === "crypto";
  const actDateStr = fmt(new Date());
  const actNo = `${actDateStr.replace(/-/g, "")}-${id.slice(0, 4).toUpperCase()}`;

  return (
    <div className="p-6 sm:p-8">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/counterparties/${id}`} className="text-sm text-slate-400 hover:text-brand">← Агент</Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex gap-1 rounded-full bg-slate-100 p-1 text-xs dark:bg-neutral-800">
            <Link href={`/agents/${id}/report`} className={`rounded-full px-3 py-1 font-medium transition ${!act ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-neutral-400"}`}>Отчёт</Link>
            <Link href={`/agents/${id}/report?act=1`} className={`rounded-full px-3 py-1 font-medium transition ${act ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-neutral-400"}`}>Акт к выплате</Link>
          </div>
          {!act && (
          <div className="inline-flex gap-1 rounded-full bg-slate-100 p-1 text-xs dark:bg-neutral-800">
            {presets.map((p) => {
              const href = p.from ? `/agents/${id}/report?from=${p.from}&to=${p.to}` : `/agents/${id}/report`;
              return (
                <Link key={p.label} href={href}
                  className={`rounded-full px-3 py-1 font-medium transition ${isActive(p) ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-neutral-400"}`}>
                  {p.label}
                </Link>
              );
            })}
          </div>
          )}
          <PrintButton />
        </div>
      </div>

      <div className="print-area mx-auto max-w-3xl rounded-2xl bg-white p-8 text-slate-900 ring-1 ring-slate-200 print:rounded-none print:ring-0">
        {act ? (
          <div className="mb-5">
            <div className="text-center">
              <h1 className="text-xl font-bold">АКТ № {actNo}</h1>
              <div className="text-sm text-slate-600">сдачи-приёмки оказанных услуг (агентское вознаграждение)</div>
              <div className="mt-1 text-sm text-slate-500">
                от {formatDate(actDateStr)}
                {agent.contract_number && <> · к договору № {agent.contract_number}{agent.contract_date && ` от ${formatDate(agent.contract_date)}`}</>}
              </div>
            </div>
            <p className="mt-5 text-sm leading-relaxed text-slate-700">
              <b>{principalName}</b>{company?.inn && `, ИНН ${company.inn}`}{company?.kpp && `, КПП ${company.kpp}`}{company?.ogrn && `, ОГРН ${company.ogrn}`}{company?.address && `, ${company.address}`}, именуемое в дальнейшем «Принципал», с одной стороны, и <b>{agent.payee_name || agent.name}</b>{agent.inn && `, ИНН ${agent.inn}`}{agent.legal_status && ` (${agent.legal_status})`}, именуемый в дальнейшем «Агент», с другой стороны, составили настоящий акт о нижеследующем:
            </p>
            <p className="mt-3 text-sm text-slate-700">
              1. Агент оказал Принципалу услуги по привлечению клиентов. Услуги оказаны полностью и в срок. Размер агентского вознаграждения, подлежащего выплате Принципалом Агенту:
            </p>
          </div>
        ) : (
          <div className="mb-6 border-b border-slate-200 pb-4">
            <div className="text-xs uppercase tracking-wider text-slate-400">{team.name}</div>
            <h1 className="mt-1 text-2xl font-bold">{docTitle}</h1>
            <div className="mt-2 text-sm text-slate-600">
              Агент: <b>{agent.payee_name || agent.name}</b>
              {agent.inn && <> · ИНН {agent.inn}</>}
              {agent.contract_number && <> · договор № {agent.contract_number}{agent.contract_date && ` от ${formatDate(agent.contract_date)}`}</>}
            </div>
            <div className="text-sm text-slate-500">{periodLabel}</div>
          </div>
        )}

        {rows.length > 0 ? (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-2">#</th>
                  <th className="py-2 pr-2">Клиент</th>
                  <th className="py-2 pr-2">Статья</th>
                  <th className="py-2 pr-2">Приход</th>
                  <th className="py-2 pr-2 text-right">База</th>
                  <th className="py-2 pr-2 text-right">%</th>
                  <th className="py-2 text-right">{valueLabel}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 pr-2 text-slate-400">{i + 1}</td>
                    <td className="py-2 pr-2">{r.client}</td>
                    <td className="py-2 pr-2 text-slate-500">{r.category}</td>
                    <td className="py-2 pr-2 text-slate-500">{r.sourceDate ? formatDate(r.sourceDate) : "—"}</td>
                    <td className="py-2 pr-2 text-right text-slate-500">{formatMoney(r.base, r.currency)}</td>
                    <td className="py-2 pr-2 text-right text-slate-500">{r.percent}%</td>
                    <td className="py-2 text-right font-semibold">{formatMoney(r.value, r.currency)}{r.paidOn && <span className="text-xs font-normal text-slate-400"> ({formatDate(r.paidOn)})</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300">
                  <td colSpan={6} className="py-3 text-right font-bold">Итого {valueLabel.toLowerCase()}:</td>
                  <td className="py-3 text-right text-base font-bold">{formatMoney(totalPaid, cur)}</td>
                </tr>
              </tfoot>
            </table>

            {act && (
              <>
                <p className="mt-3 text-sm text-slate-700">
                  Итого к выплате: <b>{formatMoney(totalPaid, cur)}</b> ({rublesInWords(totalPaid, cur)}).
                </p>
                <p className="mt-3 text-sm text-slate-700">
                  2. Услуги оказаны в полном объёме и в установленный срок. Стороны взаимных претензий по объёму, качеству и срокам оказания услуг не имеют.
                </p>
              </>
            )}

            {!act && catRows.length > 1 && (
              <div className="mt-6">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">По статьям</div>
                <table className="w-full max-w-sm text-sm">
                  <tbody>
                    {catRows.map(([name, val]) => (
                      <tr key={name} className="border-b border-slate-100">
                        <td className="py-1.5 text-slate-600">{name}</td>
                        <td className="py-1.5 text-right font-medium">{formatMoney(val, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="py-8 text-center text-slate-400">{act ? "Невыплаченного вознаграждения нет." : "Выплат за выбранный период нет."}</p>
        )}

        {/* Реквизиты для оплаты агенту */}
        {(agent.bank_account || agent.wallet_address) && (
          <div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm print:bg-transparent print:p-0">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Реквизиты для оплаты</div>
            {isCrypto ? (
              <div className="text-slate-600">Кошелёк: <b>{agent.wallet_address}</b>{agent.wallet_network && ` · сеть ${agent.wallet_network}`}</div>
            ) : (
              <div className="space-y-0.5 text-slate-600">
                {agent.payee_name && <div>Получатель: <b>{agent.payee_name}</b>{agent.legal_status && ` (${agent.legal_status})`}</div>}
                {agent.bank_account && <div>Р/с: {agent.bank_account}</div>}
                {agent.bank_name && <div>Банк: {agent.bank_name}{agent.bik && ` · БИК ${agent.bik}`}</div>}
              </div>
            )}
          </div>
        )}

        <div className="mt-12 grid grid-cols-2 gap-8 text-sm">
          <div>
            <div className="border-t border-slate-400 pt-1 text-slate-600">{act ? "Принципал" : "Исполнитель"} / {act ? principalName : team.name}</div>
            {act && <div className="mt-8 text-xs text-slate-400">подпись · М.П.</div>}
          </div>
          <div>
            <div className="border-t border-slate-400 pt-1 text-slate-600">Агент / {agent.payee_name || agent.name}</div>
            {act && <div className="mt-8 text-xs text-slate-400">подпись{isCrypto ? "" : " · М.П."}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
