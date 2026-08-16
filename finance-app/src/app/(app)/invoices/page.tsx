import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import InvoicesManager from "@/components/invoices/InvoicesManager";
import type { Invoice } from "@/lib/invoices";

export default async function InvoicesPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Инвойсы</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }
  const { team, role } = current;

  const header = (
    <header className="mb-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Инвойсы</h1>
      <p className="text-sm text-slate-500 dark:text-neutral-400">Счета на оплату клиентам в рублях, со статусами оплаты</p>
    </header>
  );

  if (!canEditFinance(role)) {
    return (
      <div className="p-6 sm:p-8">
        {header}
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Раздел доступен ролям с правом ведения финансов (владелец, админ, менеджер).
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: invRaw }, { data: counterparties }, { data: projects }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, number, counterparty_id, buyer_name, buyer_inn, buyer_kpp, project_id, currency, amount, vat_amount, purpose, issue_date, payment_expiry_date, status, tochka_document_id, paid_on, note, created_at, project:projects(name), counterparty:counterparties(name)")
      .eq("team_id", team.id)
      .order("issue_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("counterparties").select("id, name, inn").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("projects").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
  ]);

  const invoices = ((invRaw ?? []) as unknown as (Invoice & { project: { name: string } | null; counterparty: { name: string } | null })[]).map((r) => ({
    ...r,
    project_name: r.project?.name ?? null,
    counterparty_name: r.counterparty?.name ?? null,
  })) as Invoice[];

  return (
    <div className="p-6 sm:p-8">
      {header}
      <InvoicesManager
        teamId={team.id}
        invoices={invoices}
        counterparties={(counterparties ?? []) as { id: string; name: string; inn: string | null }[]}
        projects={(projects ?? []) as { id: string; name: string }[]}
      />
    </div>
  );
}
