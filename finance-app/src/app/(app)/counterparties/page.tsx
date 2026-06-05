import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { COUNTERPARTY_KIND_LABELS } from "@/lib/constants";
import AddCounterpartyForm from "@/components/AddCounterpartyForm";

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
    .select("id, name, kind, note")
    .eq("team_id", team.id)
    .eq("archived", false)
    .order("name");

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Контрагенты
          </h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Клиенты, поставщики и партнёры
          </p>
        </div>
        {canEditFinance(role) && <AddCounterpartyForm teamId={team.id} />}
      </header>

      {items && items.length > 0 ? (
        <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-neutral-800 dark:text-neutral-500">
                <th className="px-5 py-3 font-medium">Название</th>
                <th className="px-5 py-3 font-medium">Тип</th>
                <th className="px-5 py-3 font-medium">Заметка</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-slate-50 last:border-0 dark:border-neutral-800/60"
                >
                  <td className="px-5 py-3 font-medium text-slate-800 dark:text-neutral-200">
                    {c.name}
                  </td>
                  <td className="px-5 py-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
                      {COUNTERPARTY_KIND_LABELS[c.kind] ?? c.kind}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-400 dark:text-neutral-500">
                    {c.note ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:text-neutral-400 dark:ring-neutral-800">
          Пока нет контрагентов.
          {canEditFinance(role)
            ? " Добавьте первого кнопкой выше."
            : " Их может добавить владелец или менеджер."}
        </p>
      )}
    </div>
  );
}
