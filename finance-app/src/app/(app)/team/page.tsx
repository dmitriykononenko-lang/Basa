import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type AppRole } from "@/lib/types";

export default async function TeamPage() {
  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from("team_members")
    .select("role, teams(id, name, base_currency)")
    .order("created_at", { ascending: true });

  if (!memberships || memberships.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-slate-900">Команда</h1>
        <p className="mt-4 text-sm text-slate-500">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const current = memberships[0] as unknown as {
    role: AppRole;
    teams: { id: string; name: string; base_currency: string };
  };
  const team = current.teams;

  const { data: members } = await supabase
    .from("team_members")
    .select("user_id, role, created_at, profiles(full_name)")
    .eq("team_id", team.id)
    .order("created_at", { ascending: true });

  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Команда</h1>
        <p className="text-sm text-slate-500">
          {team.name} · основная валюта {team.base_currency}
        </p>
      </header>

      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Участник</th>
              <th className="px-5 py-3 font-medium">Роль</th>
              <th className="px-5 py-3 font-medium">В команде с</th>
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((m) => {
              const profile = m.profiles as unknown as {
                full_name: string | null;
              } | null;
              return (
                <tr
                  key={m.user_id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-5 py-3 font-medium text-slate-800">
                    {profile?.full_name ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {ROLE_LABELS[m.role as AppRole]}
                  </td>
                  <td className="px-5 py-3 text-slate-400">
                    {new Date(m.created_at).toLocaleDateString("ru-RU")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Приглашение участников по email и смена ролей появятся в следующем
        обновлении.
      </p>
    </div>
  );
}
