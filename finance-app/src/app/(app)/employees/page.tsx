import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/constants";
import AddEmployeeForm from "@/components/AddEmployeeForm";

export default async function EmployeesPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Сотрудники
        </h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const { team, role } = current;
  const base = team.base_currency;
  const supabase = await createClient();

  const [{ data: employees }, { data: balances }, { data: fxRows }] = await Promise.all([
    supabase
      .from("counterparties")
      .select("id, name, employment_type, payout_currency, department, end_date")
      .eq("team_id", team.id)
      .contains("kinds", ["employee"])
      .eq("archived", false)
      .order("name"),
    supabase
      .from("obligation_balances")
      .select("counterparty_id, amount, paid, outstanding, currency")
      .eq("team_id", team.id)
      .eq("type", "payable"),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  const rates = buildRateMap(fxRows ?? [], base);

  const accruedBy = new Map<string, number>();
  const paidBy = new Map<string, number>();
  const outBy = new Map<string, number>();
  let paidUSDT = 0;
  for (const o of balances ?? []) {
    if (!o.counterparty_id) continue;
    accruedBy.set(o.counterparty_id, (accruedBy.get(o.counterparty_id) ?? 0) + toBase(o.amount, o.currency, rates));
    paidBy.set(o.counterparty_id, (paidBy.get(o.counterparty_id) ?? 0) + toBase(o.paid, o.currency, rates));
    outBy.set(o.counterparty_id, (outBy.get(o.counterparty_id) ?? 0) + toBase(o.outstanding, o.currency, rates));
    if (o.currency === "USDT") paidUSDT += o.paid;
  }

  const rows = (employees ?? []).map((e) => ({
    ...e,
    accrued: accruedBy.get(e.id) ?? 0,
    paid: paidBy.get(e.id) ?? 0,
    balance: outBy.get(e.id) ?? 0,
  }));

  const totalAccrued = rows.reduce((s, r) => s + r.accrued, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Сотрудники
          </h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Тип контрагента «Сотрудник» · начислено / выплачено / остаток
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/payroll" className="btn-ghost">Зарплата →</Link>
          {canEditFinance(role) && <AddEmployeeForm teamId={team.id} />}
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi title="Начислено всего" value={formatMoney(totalAccrued, base)} />
        <Kpi title="Выплачено всего" value={formatMoney(totalPaid, base)} />
        <Kpi title="Выплачено USDT" value={formatMoney(paidUSDT, "USDT")} />
      </div>

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                <th className="px-5 py-3 font-medium">Сотрудник</th>
                <th className="px-5 py-3 font-medium">Отдел</th>
                <th className="px-5 py-3 font-medium">Тип</th>
                <th className="px-5 py-3 text-right font-medium">Начислено</th>
                <th className="px-5 py-3 text-right font-medium">Выплачено</th>
                <th className="px-5 py-3 text-right font-medium">Остаток</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/employees/${e.id}`} className="break-words text-slate-800 hover:text-brand dark:text-neutral-200">
                      {e.name}
                    </Link>
                    {e.end_date && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">уволен</span>}
                  </td>
                  <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{e.department ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">
                    {e.employment_type ? EMPLOYMENT_TYPE_LABELS[e.employment_type] ?? e.employment_type : "—"}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-700 dark:text-neutral-300">{formatMoney(e.accrued, base)}</td>
                  <td className="px-5 py-3 text-right text-slate-700 dark:text-neutral-300">{formatMoney(e.paid, base)}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${e.balance > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {formatMoney(e.balance, base)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Пока нет сотрудников.
          {canEditFinance(role) ? " Добавьте первого кнопкой выше." : " Их может добавить владелец или менеджер."}
        </p>
      )}
    </div>
  );
}

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
      <div className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{value}</div>
    </div>
  );
}
