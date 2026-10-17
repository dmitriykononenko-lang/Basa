import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";
import AgentWizard from "@/components/AgentWizard";

export default async function AgentsPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Агенты</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }

  const { team, role } = current;
  const base = team.base_currency;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: agents }, { data: bals }, { data: clients }, { data: fxRows }, { data: incomeCats }] = await Promise.all([
    supabase.from("counterparties").select("id, name").eq("team_id", team.id).contains("kinds", ["agent"]).eq("archived", false).order("name"),
    supabase.from("obligation_balances").select("counterparty_id, amount, paid, outstanding, currency").eq("team_id", team.id).eq("type", "payable"),
    supabase.from("counterparties").select("agent_id").eq("team_id", team.id).eq("archived", false).not("agent_id", "is", null),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
    supabase.from("categories").select("id, name").eq("team_id", team.id).eq("kind", "income").eq("archived", false).order("name"),
  ]);

  const rates = buildRateMap(fxRows ?? [], base);
  const agentIds = new Set((agents ?? []).map((a) => a.id));

  const accruedBy = new Map<string, number>();
  const paidBy = new Map<string, number>();
  const outBy = new Map<string, number>();
  for (const o of bals ?? []) {
    if (!o.counterparty_id || !agentIds.has(o.counterparty_id)) continue;
    accruedBy.set(o.counterparty_id, (accruedBy.get(o.counterparty_id) ?? 0) + toBase(o.amount, o.currency, rates));
    paidBy.set(o.counterparty_id, (paidBy.get(o.counterparty_id) ?? 0) + toBase(o.paid, o.currency, rates));
    outBy.set(o.counterparty_id, (outBy.get(o.counterparty_id) ?? 0) + toBase(o.outstanding, o.currency, rates));
  }
  const clientCount = new Map<string, number>();
  for (const c of clients ?? []) {
    if (!c.agent_id) continue;
    clientCount.set(c.agent_id, (clientCount.get(c.agent_id) ?? 0) + 1);
  }

  const rows = (agents ?? []).map((a) => ({
    ...a,
    accrued: accruedBy.get(a.id) ?? 0,
    paid: paidBy.get(a.id) ?? 0,
    outstanding: outBy.get(a.id) ?? 0,
    clients: clientCount.get(a.id) ?? 0,
  }));
  const totalAccrued = rows.reduce((s, r) => s + r.accrued, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  const totalOut = rows.reduce((s, r) => s + r.outstanding, 0);

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Агенты</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Комиссии агентам начисляются автоматически после прихода денег от их клиентов
          </p>
        </div>
        {canEditFinance(role) && user && (
          <AgentWizard teamId={team.id} userId={user.id} incomeCategories={(incomeCats ?? []) as { id: string; name: string }[]} />
        )}
      </header>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi title="Начислено комиссий" value={formatMoney(totalAccrued, base)} />
        <Kpi title="Выплачено" value={formatMoney(totalPaid, base)} />
        <Kpi title="К выплате" value={formatMoney(totalOut, base)} accent={totalOut > 0 ? "amber" : "emerald"} />
      </div>

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                <th className="px-5 py-3 font-medium">Агент</th>
                <th className="px-5 py-3 text-right font-medium">Клиентов</th>
                <th className="px-5 py-3 text-right font-medium">Начислено</th>
                <th className="px-5 py-3 text-right font-medium">Выплачено</th>
                <th className="px-5 py-3 text-right font-medium">К выплате</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/counterparties/${a.id}`} className="break-words text-slate-800 hover:text-brand dark:text-neutral-200">{a.name}</Link>
                  </td>
                  <td className="px-5 py-3 text-right text-slate-500 dark:text-neutral-400">{a.clients || "—"}</td>
                  <td className="px-5 py-3 text-right text-slate-700 dark:text-neutral-300">{formatMoney(a.accrued, base)}</td>
                  <td className="px-5 py-3 text-right text-slate-700 dark:text-neutral-300">{formatMoney(a.paid, base)}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${a.outstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {formatMoney(a.outstanding, base)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Агентов пока нет. Добавьте агента, задайте ему ставки комиссии (на карточке) и укажите этого
          агента у клиента — комиссия начнёт начисляться автоматически.
        </p>
      )}
    </div>
  );
}

function Kpi({ title, value, accent }: { title: string; value: string; accent?: "amber" | "emerald" }) {
  const c = accent === "amber" ? "text-amber-600 dark:text-amber-400" : accent === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white";
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
      <div className={`mt-2 text-lg font-bold ${c}`}>{value}</div>
    </div>
  );
}
