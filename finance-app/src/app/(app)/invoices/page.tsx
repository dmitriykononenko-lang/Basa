import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import InvoicesManager, { type CatalogItem } from "@/components/invoices/InvoicesManager";
import type { Invoice, VatRate } from "@/lib/invoices";

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
  const [{ data: invRaw }, { data: counterparties }, { data: projects }, { data: itemsRaw }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, number, counterparty_id, buyer_name, buyer_inn, buyer_kpp, project_id, currency, amount, vat_amount, purpose, issue_date, payment_expiry_date, status, tochka_document_id, paid_on, note, created_at, project:projects(name), counterparty:counterparties(name)")
      .eq("team_id", team.id)
      .order("issue_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("counterparties").select("id, name, inn").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("projects").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
    // Справочник ранее выставленных позиций (для автоподстановки в форме).
    supabase
      .from("invoice_items")
      .select("name, unit, price, vat_rate, invoice:invoices(created_at)")
      .eq("team_id", team.id)
      .limit(2000),
  ]);

  const invoices = ((invRaw ?? []) as unknown as (Invoice & { project: { name: string } | null; counterparty: { name: string } | null })[]).map((r) => ({
    ...r,
    project_name: r.project?.name ?? null,
    counterparty_name: r.counterparty?.name ?? null,
  })) as Invoice[];

  // Справочник позиций: по каждому наименованию — самая свежая цена/ед./НДС.
  const itemRows = (itemsRaw ?? []) as unknown as {
    name: string; unit: string; price: number; vat_rate: VatRate; invoice: { created_at: string } | null;
  }[];
  const byName = new Map<string, CatalogItem & { _ts: number }>();
  for (const r of itemRows) {
    const name = (r.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const ts = r.invoice?.created_at ? Date.parse(r.invoice.created_at) : 0;
    const prev = byName.get(key);
    if (!prev || ts > prev._ts) {
      byName.set(key, { name, unit: r.unit || "шт", price: r.price ?? 0, vat_rate: (r.vat_rate ?? "none") as VatRate, _ts: ts });
    }
  }
  const catalog: CatalogItem[] = [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .map(({ name, unit, price, vat_rate }) => ({ name, unit, price, vat_rate }));

  return (
    <div className="p-6 sm:p-8">
      {header}
      <InvoicesManager
        teamId={team.id}
        invoices={invoices}
        counterparties={(counterparties ?? []) as { id: string; name: string; inn: string | null }[]}
        projects={(projects ?? []) as { id: string; name: string }[]}
        catalog={catalog}
      />
    </div>
  );
}
