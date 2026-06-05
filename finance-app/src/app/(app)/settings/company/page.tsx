import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canManageTeam } from "@/lib/team";
import EditCompany from "@/components/EditCompany";

export default async function CompanyPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Профиль компании
        </h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const { team, role } = current;
  const supabase = await createClient();
  const { data: full } = await supabase
    .from("teams")
    .select("id, name, base_currency, legal_name, inn, kpp, ogrn, address")
    .eq("id", team.id)
    .single();

  return (
    <div className="p-6 sm:p-8">
      <Link href="/settings" className="text-sm text-slate-400 hover:text-brand">← Настройки</Link>
      <header className="mb-6 mt-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Профиль компании
        </h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Название и реквизиты вашей компании
        </p>
      </header>

      {canManageTeam(role) && full ? (
        <EditCompany
          initial={{
            id: full.id,
            name: full.name ?? "",
            base_currency: full.base_currency ?? "RUB",
            legal_name: full.legal_name ?? "",
            inn: full.inn ?? "",
            kpp: full.kpp ?? "",
            ogrn: full.ogrn ?? "",
            address: full.address ?? "",
          }}
        />
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Редактировать профиль компании может владелец или администратор.
        </p>
      )}
    </div>
  );
}
