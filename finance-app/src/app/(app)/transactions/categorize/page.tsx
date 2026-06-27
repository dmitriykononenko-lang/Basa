import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { fetchAllRows } from "@/lib/supabase/paginate";
import CategorizeWizard, { type WizardOp, type WizardCat } from "@/components/CategorizeWizard";

type RawOp = {
  id: string; type: "income" | "expense"; amount: number; currency: string; occurred_on: string;
  note: string | null; counterparty_id: string | null;
  account: { name: string } | null; counterparty: { name: string } | null;
};

export default async function CategorizePage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Распределение статей</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }
  const { team, role } = current;
  const supabase = await createClient();

  const [uncat, catPairs, { data: categories }, { data: projects }] = await Promise.all([
    // Операции без статьи (доход/расход), без переводов
    fetchAllRows<RawOp>((from, to) =>
      supabase
        .from("transactions")
        .select("id, type, amount, currency, occurred_on, note, counterparty_id, account:accounts!transactions_account_id_fkey(name), counterparty:counterparties(name)")
        .eq("team_id", team.id).eq("status", "actual").is("category_id", null).in("type", ["income", "expense"])
        .order("occurred_on", { ascending: false }).range(from, to) as unknown as PromiseLike<{ data: RawOp[] | null; error: unknown }>
    ),
    // История «контрагент → статья» для подсказок/автораспределения
    fetchAllRows<{ counterparty_id: string; category_id: string }>((from, to) =>
      supabase
        .from("transactions")
        .select("counterparty_id, category_id")
        .eq("team_id", team.id).eq("status", "actual").not("category_id", "is", null).not("counterparty_id", "is", null)
        .order("counterparty_id").range(from, to)
    ),
    supabase.from("categories").select("id, name, kind").eq("team_id", team.id).eq("archived", false),
    supabase.from("projects").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
  ]);

  // Частота статей и доминирующая статья по контрагенту
  const catFreq = new Map<string, number>();
  const cpCat = new Map<string, Map<string, number>>();
  for (const r of catPairs) {
    catFreq.set(r.category_id, (catFreq.get(r.category_id) ?? 0) + 1);
    let m = cpCat.get(r.counterparty_id);
    if (!m) { m = new Map(); cpCat.set(r.counterparty_id, m); }
    m.set(r.category_id, (m.get(r.category_id) ?? 0) + 1);
  }
  const suggestionByCp: Record<string, string> = {};
  for (const [cp, m] of cpCat) {
    let best: string | null = null; let bestN = 0;
    for (const [cat, n] of m) if (n > bestN) { best = cat; bestN = n; }
    if (best && bestN >= 2) suggestionByCp[cp] = best; // уверенная подсказка
  }

  const cats: WizardCat[] = ((categories ?? []) as WizardCat[])
    .map((c) => ({ ...c, freq: catFreq.get(c.id) ?? 0 }))
    .sort((a, b) => (b.freq ?? 0) - (a.freq ?? 0) || a.name.localeCompare(b.name));

  const ops: WizardOp[] = (uncat as RawOp[]).map((o) => ({
    id: o.id, type: o.type, amount: o.amount, currency: o.currency, occurred_on: o.occurred_on,
    note: o.note, counterpartyId: o.counterparty_id,
    accountName: o.account?.name ?? null, counterpartyName: o.counterparty?.name ?? null,
  }));

  return (
    <div className="p-6 sm:p-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Распределение статей</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">Проставьте статью каждой операции — быстро, по одной</p>
        </div>
        <Link href="/transactions" className="btn-ghost">К операциям</Link>
      </div>

      {ops.length === 0 ? (
        <div className="rounded-3xl bg-white p-10 text-center ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <div className="text-2xl">🎉</div>
          <p className="mt-2 text-sm font-medium text-slate-700 dark:text-neutral-200">Все операции распределены</p>
          <p className="text-xs text-slate-400">Операций без статьи нет.</p>
        </div>
      ) : (
        <CategorizeWizard
          ops={ops}
          categories={cats}
          projects={(projects ?? []) as { id: string; name: string }[]}
          suggestionByCp={suggestionByCp}
          teamId={team.id}
          canEdit={canEditFinance(role)}
        />
      )}
    </div>
  );
}
