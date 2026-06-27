import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTeam, canManageTeam } from "@/lib/team";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import UserRoleCard from "@/components/UserRoleCard";

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export default async function TeamUserPage({ params }: { params: { userId: string } }) {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Пользователь</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }

  const { team, role } = current;
  if (!canManageTeam(role)) {
    return (
      <div className="p-6 sm:p-8">
        <Link href="/team" className="text-sm text-slate-400 hover:text-brand">← Команда</Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Пользователь</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Управление участниками доступно владельцу и администратору.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: member } = await supabase
    .from("team_members")
    .select("user_id, role, created_at")
    .eq("team_id", team.id)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!member) {
    return (
      <div className="p-6 sm:p-8">
        <Link href="/team" className="text-sm text-slate-400 hover:text-brand">← Команда</Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Пользователь</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Участник не найден в этой команде.</p>
      </div>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", params.userId)
    .maybeSingle();

  // email лежит в auth.users — достаём admin-клиентом (если задан service_role)
  let email: string | null = null;
  const admin = createAdminClient();
  if (admin) {
    const { data } = await admin.auth.admin.getUserById(params.userId);
    email = data.user?.email ?? null;
  }

  const name = profile?.full_name ?? email ?? "Без имени";
  const isSelf = params.userId === user?.id;

  return (
    <div className="p-6 sm:p-8">
      <Link href="/team" className="text-sm text-slate-400 hover:text-brand">← Команда</Link>

      <header className="mb-6 mt-2 flex items-center gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand text-lg font-semibold text-white">
          {initials(name)}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            {name}{isSelf && <span className="ml-2 align-middle text-sm font-normal text-slate-400">(вы)</span>}
          </h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            {email ?? "email скрыт"} · сейчас: {ROLE_LABELS[member.role as AppRole]}
          </p>
        </div>
      </header>

      <div className="max-w-2xl rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <dl className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-neutral-500">Эл. почта</dt>
            <dd className="mt-0.5 text-sm text-slate-800 dark:text-neutral-200">{email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-neutral-500">В команде с</dt>
            <dd className="mt-0.5 text-sm text-slate-800 dark:text-neutral-200">
              {new Date(member.created_at).toLocaleDateString("ru-RU")}
            </dd>
          </div>
        </dl>

        <UserRoleCard
          teamId={team.id}
          userId={params.userId}
          currentRole={member.role as AppRole}
          isSelf={isSelf}
        />
      </div>
    </div>
  );
}
