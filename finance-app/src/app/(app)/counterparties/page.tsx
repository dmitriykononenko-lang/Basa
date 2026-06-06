import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import AddCounterpartyForm from "@/components/AddCounterpartyForm";
import CounterpartiesTable from "@/components/CounterpartiesTable";
import DuplicateSuggestions, { type DupGroup } from "@/components/DuplicateSuggestions";

type CpItem = { id: string; name: string; kind: string; kinds: string[] | null; inn: string | null; contact_person: string | null };

const normName = (s: string | null) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[«»"'`]/g, "")
    .replace(/\b(ооо|оао|зао|пао|ао|ип|нко|тоо|llc|ltd|inc)\b/gi, "")
    .replace(/[^a-zа-яё0-9]/gi, "");

// Группы возможных дублей по ИНН и нормализованному названию (union-find)
function findDuplicateGroups(items: CpItem[]): DupGroup[] {
  const parent = items.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  const seen = new Map<string, number>();
  items.forEach((c, i) => {
    const keys: string[] = [];
    if (c.inn && c.inn.trim()) keys.push("inn:" + c.inn.trim());
    const n = normName(c.name);
    if (n.length >= 3) keys.push("name:" + n);
    for (const k of keys) {
      if (seen.has(k)) union(i, seen.get(k)!);
      else seen.set(k, i);
    }
  });
  const groups = new Map<number, CpItem[]>();
  items.forEach((c, i) => {
    const r = find(i);
    const arr = groups.get(r) ?? [];
    arr.push(c);
    groups.set(r, arr);
  });
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => g.map((c) => ({ id: c.id, name: c.name, inn: c.inn })));
}

export default async function CounterpartiesPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Контрагенты
        </h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const { team, role } = current;
  const supabase = await createClient();

  const { data: items } = await supabase
    .from("counterparties")
    .select("id, name, kind, kinds, inn, contact_person")
    .eq("team_id", team.id)
    .eq("archived", false)
    .order("name");

  const manage = canEditFinance(role);
  const dupGroups = manage ? findDuplicateGroups((items ?? []) as CpItem[]) : [];

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Контрагенты
          </h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Клиенты, поставщики, партнёры и сотрудники
          </p>
        </div>
        {manage && <AddCounterpartyForm teamId={team.id} />}
      </header>

      {dupGroups.length > 0 && <DuplicateSuggestions groups={dupGroups} />}

      {items && items.length > 0 ? (
        <CounterpartiesTable items={items} canManage={manage} />
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Пока нет контрагентов.
          {manage ? " Добавьте первого кнопкой выше." : " Их может добавить владелец или менеджер."}
        </p>
      )}
    </div>
  );
}
