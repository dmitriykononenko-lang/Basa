"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/format";
import { toBase, type RateMap } from "@/lib/fx";
import AccountCard, { type AccountFull } from "@/components/AccountCard";

export default function AccountsList({
  accounts,
  balances,
  canEdit,
  base,
  rates,
}: {
  accounts: AccountFull[];
  balances: Record<string, number>;
  canEdit: boolean;
  base: string;
  rates: RateMap;
}) {
  const [selected, setSelected] = useState<AccountFull | null>(null);

  const entities = useMemo(
    () => [...new Set(accounts.map((a) => a.legal_entity).filter((x): x is string => !!x))].sort(),
    [accounts]
  );

  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  // группировка активных по юр.лицу
  const groups = useMemo(() => {
    const m = new Map<string, AccountFull[]>();
    for (const a of active) {
      const key = a.legal_entity?.trim() || "Без юр. лица";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a);
    }
    return [...m.entries()];
  }, [active]);

  function Card({ a }: { a: AccountFull }) {
    const balance = balances[a.id] ?? 0;
    return (
      <button
        type="button"
        onClick={() => setSelected(a)}
        className="rounded-3xl bg-white p-5 text-left ring-1 ring-slate-200/80 transition hover:ring-brand/40 dark:bg-[#15171c] dark:ring-white/[0.07] dark:hover:ring-brand/40"
      >
        <div className="text-sm font-medium text-slate-800 dark:text-neutral-200">{a.name}</div>
        <div className="mt-0.5 truncate text-xs text-slate-400 dark:text-neutral-500">
          {a.bank_name ? `${a.bank_name} · ` : ""}{a.number ?? a.currency}
        </div>
        <div className="mt-3 text-xl font-bold text-slate-900 dark:text-white">
          {formatMoney(balance, a.currency)}
        </div>
      </button>
    );
  }

  // Итоги: по валютам + всё в базовой по курсу
  const totals = useMemo(() => {
    const byCur = new Map<string, number>();
    let baseTotal = 0;
    for (const a of active) {
      const bal = balances[a.id] ?? 0;
      byCur.set(a.currency, (byCur.get(a.currency) ?? 0) + bal);
      baseTotal += toBase(bal, a.currency, rates);
    }
    return { byCur: [...byCur.entries()], baseTotal };
  }, [active, balances, rates]);

  return (
    <>
      <div className="mb-6">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Деньги на счетах</div>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-3xl bg-brand/5 px-5 py-4 ring-1 ring-brand/20 dark:bg-brand/10">
            <div className="text-[11px] text-slate-500 dark:text-neutral-400">Итого в {base} (по курсу)</div>
            <div className="mt-0.5 text-2xl font-extrabold text-slate-900 dark:text-white">{formatMoney(totals.baseTotal, base)}</div>
          </div>
          {totals.byCur.map(([cur, sum]) => (
            <div key={cur} className="rounded-3xl bg-white px-5 py-4 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
              <div className="text-[11px] text-slate-500 dark:text-neutral-400">Итого {cur}</div>
              <div className="mt-0.5 text-lg font-bold text-slate-800 dark:text-neutral-200">{formatMoney(sum, cur)}</div>
              {cur !== base && (
                <div className="text-[11px] text-slate-400">≈ {formatMoney(toBase(sum, cur, rates), base)}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {groups.length > 0 ? (
        <div className="space-y-8">
          {groups.map(([entity, list]) => (
            <section key={entity}>
              <h2 className="mb-3 text-sm font-bold text-slate-800 dark:text-neutral-200">{entity}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((a) => <Card key={a.id} a={a} />)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Пока нет счетов.
        </p>
      )}

      {archived.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
            Закрытые счета
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelected(a)}
                className="flex items-center justify-between rounded-3xl bg-slate-50 p-4 text-left ring-1 ring-slate-200/80 dark:bg-[#15171c]/50 dark:ring-white/[0.07]"
              >
                <div>
                  <div className="text-sm font-medium text-slate-500 dark:text-neutral-400">{a.name}</div>
                  <div className="text-xs text-slate-400 dark:text-neutral-600">{formatMoney(balances[a.id] ?? 0, a.currency)}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {selected && (
        <AccountCard
          open
          onClose={() => setSelected(null)}
          account={selected}
          balance={balances[selected.id] ?? 0}
          entities={entities}
          canEdit={canEdit}
        />
      )}
    </>
  );
}
