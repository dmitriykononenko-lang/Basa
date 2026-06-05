import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canManageTeam } from "@/lib/team";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import InviteForm from "@/components/InviteForm";
import InviteRevoke from "@/components/InviteRow";
import MemberRoleControls from "@/components/MemberRoleControls";

export default async function TeamPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Команда
        </h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const { team, role } = current;
  const manage = canManageTeam(role);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: members } = await supabase
    .from("team_members")
    .select("user_id, role, created_at, profiles(full_name)")
    .eq("team_id", team.id)
    .order("created_at", { ascending: true });

  const { data: invites } = manage
    ? await supabase
        .from("invites")
        .select("id, email, role, status")
        .eq("team_id", team.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Команда
        </h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          {team.name} · основная валюта {team.base_currency}
        </p>
      </header>

      {manage && user && (
        <div className="mb-6">
          <InviteForm teamId={team.id} userId={user.id} />
        </div>
      )}

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
        Участники
      </h2>
      <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-neutral-800 dark:text-neutral-500">
              <th className="px-5 py-3 font-medium">Участник</th>
              <th className="px-5 py-3 font-medium">В команде с</th>
              <th className="px-5 py-3 text-right font-medium">Роль</th>
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((m) => {
              const profile = m.profiles as unknown as {
                full_name: string | null;
              } | null;
              const isSelf = m.user_id === user?.id;
              return (
                <tr
                  key={m.user_id}
                  className="border-b border-slate-50 last:border-0 dark:border-neutral-800/60"
                >
                  <td className="px-5 py-3 font-medium text-slate-800 dark:text-neutral-200">
                    {profile?.full_name ?? "—"}
                    {isSelf && (
                      <span className="ml-2 text-xs text-slate-400">(вы)</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-400 dark:text-neutral-500">
                    {new Date(m.created_at).toLocaleDateString("ru-RU")}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {manage && !isSelf ? (
                      <MemberRoleControls
                        teamId={team.id}
                        userId={m.user_id}
                        currentRole={m.role as AppRole}
                      />
                    ) : (
                      <span className="text-slate-600 dark:text-neutral-400">
                        {ROLE_LABELS[m.role as AppRole]}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {manage && (invites?.length ?? 0) > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
            Ожидают принятия
          </h2>
          <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800">
            <table className="w-full text-sm">
              <tbody>
                {(invites ?? []).map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-slate-50 last:border-0 dark:border-neutral-800/60"
                  >
                    <td className="px-5 py-3 font-medium text-slate-800 dark:text-neutral-200">
                      {inv.email}
                    </td>
                    <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">
                      {ROLE_LABELS[inv.role as AppRole]}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <InviteRevoke inviteId={inv.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!manage && (
        <p className="mt-4 text-xs text-slate-400 dark:text-neutral-600">
          Управление участниками доступно владельцу и администратору.
        </p>
      )}
    </div>
  );
}
