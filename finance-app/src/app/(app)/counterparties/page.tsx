import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import AddCounterpartyForm from "@/components/AddCounterpartyForm";
import CounterpartiesTable from "@/components/CounterpartiesTable";

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
    .select("id, name, kind, inn, contact_person")
    .eq("team_id", team.id)
    .eq("archived", false)
    .order("name");

  const manage = canEditFinance(role);

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
